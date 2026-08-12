import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { AppConfig } from '../config/types';

export interface EcsStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  repository: ecr.IRepository;
  appConfig: AppConfig;
}

export class EcsStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly service: ecs.FargateService;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    const { vpc, repository, appConfig } = props;

    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: `${appConfig.name}-cluster`,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    // Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      cpu: appConfig.cpu || 256,
      memoryLimitMiB: appConfig.memory || 512,
      family: `${appConfig.name}-task`,
      ephemeralStorageGiB: appConfig.ephemeralStorageGiB,
    });

    // 앱이 실행 중 필요로 하는 추가 권한 (S3, DynamoDB 접근 등)
    (appConfig.taskRolePolicyStatements || []).forEach((statementProps) => {
      taskDefinition.taskRole.addToPrincipalPolicy(new iam.PolicyStatement(statementProps));
    });

    // Secrets Manager 매핑: 신규 생성 또는 기존 Secret 재사용
    const secrets: { [key: string]: ecs.Secret } = {};
    (appConfig.secrets || []).forEach((mapping) => {
      const secret = mapping.existingSecretArn
        ? secretsmanager.Secret.fromSecretCompleteArn(this, `Secret-${mapping.envVarName}`, mapping.existingSecretArn)
        : new secretsmanager.Secret(this, `Secret-${mapping.envVarName}`, {
            secretName: mapping.secretName || `${appConfig.name}/${mapping.envVarName}`,
            description: `Secret for ${appConfig.name}`,
            generateSecretString: {
              secretStringTemplate: JSON.stringify({}),
              generateStringKey: 'placeholder',
            },
          });

      secrets[mapping.envVarName] = mapping.jsonField
        ? ecs.Secret.fromSecretsManager(secret, mapping.jsonField)
        : ecs.Secret.fromSecretsManager(secret);
    });

    const logRetention = appConfig.logRetention || logs.RetentionDays.ONE_WEEK;

    // Main Container
    const container = taskDefinition.addContainer('Container', {
      containerName: appConfig.name,
      image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
      environment: appConfig.environmentVariables || {},
      secrets,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: appConfig.name,
        logRetention,
      }),
    });

    container.addPortMappings({
      containerPort: appConfig.containerPort,
      protocol: ecs.Protocol.TCP,
    });

    // Sidecar 컨테이너 (로그 수집기, APM 에이전트 등)
    (appConfig.sidecars || []).forEach((sidecar) => {
      const sidecarContainer = taskDefinition.addContainer(sidecar.name, {
        containerName: sidecar.name,
        image: ecs.ContainerImage.fromRegistry(sidecar.image),
        cpu: sidecar.cpu,
        memoryLimitMiB: sidecar.memory,
        essential: sidecar.essential ?? false,
        environment: sidecar.environmentVariables || {},
        logging: ecs.LogDrivers.awsLogs({
          streamPrefix: sidecar.name,
          logRetention,
        }),
      });

      if (sidecar.containerPort) {
        sidecarContainer.addPortMappings({
          containerPort: sidecar.containerPort,
          protocol: ecs.Protocol.TCP,
        });
      }
    });

    // Application Load Balancer
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true,
      loadBalancerName: `${appConfig.name}-alb`,
    });

    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc,
      port: appConfig.containerPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    this.loadBalancer.addListener('Listener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [targetGroup],
    });

    // 네트워킹: 운영 VPC는 Private+NAT, 개인 테스트용 기본 VPC는 Public Subnet만 있는 경우가 많아 옵션으로 분리
    const subnetType =
      appConfig.network?.subnetType === 'PUBLIC' ? ec2.SubnetType.PUBLIC : ec2.SubnetType.PRIVATE_WITH_EGRESS;
    const assignPublicIp = appConfig.network?.assignPublicIp ?? subnetType === ec2.SubnetType.PUBLIC;

    this.service = new ecs.FargateService(this, 'Service', {
      cluster: this.cluster,
      taskDefinition,
      serviceName: `${appConfig.name}-service`,
      desiredCount: appConfig.desiredCount || 2,
      assignPublicIp,
      vpcSubnets: { subnetType },
      healthCheckGracePeriod: cdk.Duration.seconds(60),
      circuitBreaker: {
        rollback: true,
      },
    });

    this.service.attachToApplicationTargetGroup(targetGroup);

    if (appConfig.autoScaling) {
      const scaling = this.service.autoScaleTaskCount({
        minCapacity: appConfig.autoScaling.minCapacity,
        maxCapacity: appConfig.autoScaling.maxCapacity,
      });

      scaling.scaleOnCpuUtilization('CpuScaling', {
        targetUtilizationPercent: appConfig.autoScaling.targetCpuUtilization,
        scaleInCooldown: cdk.Duration.seconds(60),
        scaleOutCooldown: cdk.Duration.seconds(60),
      });

      scaling.scaleOnMemoryUtilization('MemoryScaling', {
        targetUtilizationPercent: 70,
        scaleInCooldown: cdk.Duration.seconds(60),
        scaleOutCooldown: cdk.Duration.seconds(60),
      });
    }

    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: this.loadBalancer.loadBalancerDnsName,
      description: 'ALB DNS Name',
    });

    new cdk.CfnOutput(this, 'ServiceName', {
      value: this.service.serviceName,
    });

    new cdk.CfnOutput(this, 'ClusterName', {
      value: this.cluster.clusterName,
    });
  }
}
