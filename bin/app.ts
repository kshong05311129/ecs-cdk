#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { VpcStack } from '../lib/vpc-stack';
import { EcrStack } from '../lib/ecr-stack';
import { EcsStack } from '../lib/ecs-stack';
import { devConfig } from '../config/dev';

// 기존 CodePipeline/CodeBuild와의 연동은 아직 이 CDK 앱의 범위 밖입니다.
// (고객 파이프라인 구조 확인 후 별도 스택으로 추가 예정 — lib/pipeline-stack.ts 참고)

const app = new cdk.App();

// 1. VPC는 계정마다 이미 존재 → 생성이 아니라 조회(lookup)
const vpcStack = new VpcStack(app, 'VpcStack', {
  env: devConfig.env,
  vpcId: devConfig.vpcId,
  vpcTags: devConfig.vpcTags,
  description: 'Existing VPC lookup for ECS Fargate services',
});

// 2. 각 앱마다 ECR, ECS Stack 생성 (MSA: 컨테이너 서비스 1개 = ECR/ECS 1개)
devConfig.apps.forEach((appConfig) => {
  const appName = appConfig.name;
  // 'api-server' → 'ApiServer' (하이픈 제거 + 단어별 대문자화)
  const stackPrefix = appName
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

  const ecrStack = new EcrStack(app, `${stackPrefix}EcrStack`, {
    env: devConfig.env,
    repositoryName: appConfig.repository,
    importExisting: appConfig.ecrImportExisting,
    description: `ECR repository for ${appName}`,
  });

  const ecsStack = new EcsStack(app, `${stackPrefix}EcsStack`, {
    env: devConfig.env,
    vpc: vpcStack.vpc,
    repository: ecrStack.repository,
    appConfig,
    description: `ECS Fargate service for ${appName}`,
  });
  ecsStack.addStackDependency(vpcStack);
  ecsStack.addStackDependency(ecrStack);
});

// Tags 추가 (모든 리소스에 공통 태그 적용)
cdk.Tags.of(app).add('Environment', 'dev');
cdk.Tags.of(app).add('ManagedBy', 'CDK');

app.synth();
