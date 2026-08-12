import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { EcsStack } from '../lib/ecs-stack';
import { AppConfig } from '../config/types';

const TEST_ENV = { account: '111111111111', region: 'ap-northeast-2' };

// AWS 계정/자격증명 없이 오프라인으로 검증하기 위해 fromLookup 대신 진짜 VPC/ECR을
// 같은 앱 안의 별도 스택에 만들어서 넘겨준다 (cross-stack 참조는 CDK가 알아서 처리).
let testCounter = 0;

function buildTestStack(id: string) {
  const app = new cdk.App();
  const support = new cdk.Stack(app, `${id}Support`, { env: TEST_ENV });
  const vpc = new ec2.Vpc(support, 'TestVpc', {
    maxAzs: 2,
    natGateways: 1,
    subnetConfiguration: [
      { cidrMask: 24, name: 'Public', subnetType: ec2.SubnetType.PUBLIC },
      { cidrMask: 24, name: 'Private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    ],
  });
  const repository = new ecr.Repository(support, 'TestRepo', { repositoryName: 'test-repo' });
  return { app, vpc, repository };
}

function synth(appConfig: AppConfig) {
  testCounter += 1;
  const { app, vpc, repository } = buildTestStack(`Test${testCounter}`);
  const stack = new EcsStack(app, 'TestEcsStack', {
    env: TEST_ENV,
    vpc,
    repository,
    appConfig,
  });
  return Template.fromStack(stack);
}

const baseConfig: AppConfig = {
  name: 'api-server',
  containerPort: 8080,
  repository: 'api-server-repo',
};

describe('EcsStack', () => {
  test('기본 설정으로 Cluster/Service/ALB/HealthCheck가 생성된다', () => {
    const template = synth(baseConfig);

    template.resourceCountIs('AWS::ECS::Cluster', 1);
    template.resourceCountIs('AWS::ECS::Service', 1);
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      HealthCheckPath: '/health',
      Port: 8080,
    });
  });

  test('secrets를 지정하면 신규 Secret과 컨테이너 매핑이 생성된다', () => {
    const template = synth({
      ...baseConfig,
      secrets: [{ envVarName: 'OPENAI_API_KEY', secretName: 'api-server/OPENAI_API_KEY' }],
    });

    template.resourceCountIs('AWS::SecretsManager::Secret', 1);
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: 'api-server',
          Secrets: Match.arrayWith([Match.objectLike({ Name: 'OPENAI_API_KEY' })]),
        }),
      ]),
    });
  });

  test('existingSecretArn을 지정하면 새로 생성하지 않고 재사용한다', () => {
    const template = synth({
      ...baseConfig,
      secrets: [
        {
          envVarName: 'EXTERNAL_API_KEY',
          existingSecretArn:
            'arn:aws:secretsmanager:ap-northeast-2:111111111111:secret:shared/ExternalKey-AbCdEf',
        },
      ],
    });

    template.resourceCountIs('AWS::SecretsManager::Secret', 0);
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Secrets: Match.arrayWith([Match.objectLike({ Name: 'EXTERNAL_API_KEY' })]),
        }),
      ]),
    });
  });

  test('sidecar 컨테이너가 TaskDefinition에 추가된다', () => {
    const template = synth({
      ...baseConfig,
      sidecars: [{ name: 'log-router', image: 'amazon/aws-for-fluent-bit:latest' }],
    });

    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([Match.objectLike({ Name: 'log-router' })]),
    });
  });

  test('taskRolePolicyStatements로 지정한 권한이 Task Role 정책에 포함된다', () => {
    const template = synth({
      ...baseConfig,
      taskRolePolicyStatements: [{ actions: ['s3:GetObject'], resources: ['arn:aws:s3:::my-bucket/*'] }],
    });

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: 's3:GetObject', Resource: 'arn:aws:s3:::my-bucket/*' }),
        ]),
      }),
    });
  });

  test('network.subnetType이 PUBLIC이면 AssignPublicIp가 ENABLED다', () => {
    const template = synth({
      ...baseConfig,
      network: { subnetType: 'PUBLIC', assignPublicIp: true },
    });

    template.hasResourceProperties('AWS::ECS::Service', {
      NetworkConfiguration: Match.objectLike({
        AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: 'ENABLED' }),
      }),
    });
  });

  test('network 설정이 없으면 기본값은 Private + AssignPublicIp DISABLED다', () => {
    const template = synth(baseConfig);

    template.hasResourceProperties('AWS::ECS::Service', {
      NetworkConfiguration: Match.objectLike({
        AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: 'DISABLED' }),
      }),
    });
  });
});
