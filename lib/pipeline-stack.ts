import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import { AppConfig, NotificationConfig } from '../config/types';

export interface PipelineStackProps extends cdk.StackProps {
  repository: ecr.IRepository;
  ecsService: ecs.IBaseService;
  cluster: ecs.ICluster;
  appConfig: AppConfig;
  notification?: NotificationConfig;
}

export class PipelineStack extends cdk.Stack {
  public readonly codeRepository: codecommit.Repository;
  public readonly pipeline: codepipeline.Pipeline;

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const { repository, ecsService, cluster, appConfig, notification } = props;

    // CodeCommit Repository 생성
    this.codeRepository = new codecommit.Repository(this, 'CodeRepository', {
      repositoryName: appConfig.repository,
      description: `Source code repository for ${appConfig.name}`,
    });

    // SNS Topic for notifications
    let topic: sns.Topic | undefined;
    if (notification?.email || notification?.slackWebhook) {
      topic = new sns.Topic(this, 'PipelineTopic', {
        displayName: `${appConfig.name} Pipeline Notifications`,
      });

      if (notification.email) {
        topic.addSubscription(new subscriptions.EmailSubscription(notification.email));
      }

      if (notification.slackWebhook) {
        topic.addSubscription(new subscriptions.UrlSubscription(notification.slackWebhook));
      }
    }

    // CodeBuild Project
    const buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
      projectName: `${appConfig.name}-build`,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true, // Docker 빌드를 위해 필요
        computeType: codebuild.ComputeType.SMALL,
      },
      environmentVariables: {
        AWS_DEFAULT_REGION: {
          value: this.region,
        },
        AWS_ACCOUNT_ID: {
          value: this.account,
        },
        IMAGE_REPO_NAME: {
          value: repository.repositoryName,
        },
        IMAGE_TAG: {
          value: 'latest',
        },
        CONTAINER_NAME: {
          value: appConfig.name,
        },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: {
            commands: [
              'echo Logging in to Amazon ECR...',
              'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com',
              'REPOSITORY_URI=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME',
              'COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)',
              'IMAGE_TAG=${COMMIT_HASH:=latest}',
            ],
          },
          build: {
            commands: [
              'echo Build started on `date`',
              'echo Building the Docker image...',
              'docker build -t $REPOSITORY_URI:latest .',
              'docker tag $REPOSITORY_URI:latest $REPOSITORY_URI:$IMAGE_TAG',
            ],
          },
          post_build: {
            commands: [
              'echo Build completed on `date`',
              'echo Pushing the Docker images...',
              'docker push $REPOSITORY_URI:latest',
              'docker push $REPOSITORY_URI:$IMAGE_TAG',
              'echo Writing image definitions file...',
              'printf \'[{"name":"%s","imageUri":"%s"}]\' $CONTAINER_NAME $REPOSITORY_URI:latest > imagedefinitions.json',
              'cat imagedefinitions.json',
            ],
          },
        },
        artifacts: {
          files: ['imagedefinitions.json'],
        },
      }),
    });

    // CodeBuild에 ECR 권한 부여
    repository.grantPullPush(buildProject);

    // Pipeline Artifacts
    const sourceOutput = new codepipeline.Artifact('SourceOutput');
    const buildOutput = new codepipeline.Artifact('BuildOutput');

    // CodePipeline 생성
    this.pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: `${appConfig.name}-pipeline`,
      restartExecutionOnUpdate: true,
    });

    // Stage 1: Source
    this.pipeline.addStage({
      stageName: 'Source',
      actions: [
        new codepipeline_actions.CodeCommitSourceAction({
          actionName: 'CodeCommit',
          repository: this.codeRepository,
          branch: 'main',
          output: sourceOutput,
          trigger: codepipeline_actions.CodeCommitTrigger.EVENTS, // 자동 트리거
        }),
      ],
    });

    // Stage 2: Build
    this.pipeline.addStage({
      stageName: 'Build',
      actions: [
        new codepipeline_actions.CodeBuildAction({
          actionName: 'DockerBuild',
          project: buildProject,
          input: sourceOutput,
          outputs: [buildOutput],
        }),
      ],
    });

    // Stage 3: Deploy
    this.pipeline.addStage({
      stageName: 'Deploy',
      actions: [
        new codepipeline_actions.EcsDeployAction({
          actionName: 'EcsDeploy',
          service: ecsService,
          input: buildOutput,
          deploymentTimeout: cdk.Duration.minutes(10),
        }),
      ],
    });

    // Pipeline 이벤트를 SNS로 전송
    if (topic) {
      this.pipeline.onStateChange('PipelineStateChange', {
        target: new targets.SnsTopic(topic),
        eventPattern: {
          detail: {
            state: ['SUCCEEDED', 'FAILED'],
          },
        },
      });
    }

    // Outputs
    new cdk.CfnOutput(this, 'CodeRepositoryUrl', {
      value: this.codeRepository.repositoryCloneUrlHttp,
      exportName: `${appConfig.name}-CodeRepositoryUrl`,
      description: 'CodeCommit Repository Clone URL',
    });

    new cdk.CfnOutput(this, 'PipelineName', {
      value: this.pipeline.pipelineName,
      exportName: `${appConfig.name}-PipelineName`,
    });

    new cdk.CfnOutput(this, 'PipelineConsoleUrl', {
      value: `https://${this.region}.console.aws.amazon.com/codesuite/codepipeline/pipelines/${this.pipeline.pipelineName}/view`,
      description: 'Pipeline Console URL',
    });
  }
}
