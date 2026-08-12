import { EnvironmentConfig } from './types';
import * as logs from 'aws-cdk-lib/aws-logs';

export const devConfig: EnvironmentConfig = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT || 'YOUR_ACCOUNT_ID', // TODO: 실제 계정 ID 입력
    region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-2',
  },

  // 계정에 이미 있는 VPC를 조회해서 사용합니다 (신규 생성 X).
  // - vpcId를 알면 지정하세요. 모르면 vpcId/vpcTags를 둘 다 비워두면 계정의 Default VPC를 사용합니다.
  //   (개인 샌드박스 계정으로 테스트할 때 유용 — 모든 신규 계정에는 Default VPC가 기본으로 있습니다)
   vpcId: 'vpc-0d4c3994d2cf21572',

  apps: [
    {
      name: 'api-server',
      containerPort: 8080,
      cpu: 256,          // 0.25 vCPU
      memory: 512,       // 512 MB
      desiredCount: 2,
      repository: 'api-server-repo',
      // 이 ECR이 이미 존재하는 경우 (신규 생성 대신 조회만) — true로 바꾸세요
      // ecrImportExisting: true,

      // 외부 API 키 등 — 신규 생성 vs 기존 Secret 재사용 둘 다 지원
      secrets: [
        // 신규 생성: 빈 값으로 만들어지고, 실제 값은 배포 후 Secrets Manager 콘솔에서 입력
        { envVarName: 'OPENAI_API_KEY', secretName: 'api-server/OPENAI_API_KEY' },

        // 기존에 이미 만들어둔 Secret을 재사용하고 싶을 때 (예: 팀 공용 키)
        // { envVarName: 'EXTERNAL_API_KEY', existingSecretArn: 'arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:shared/ExternalKey-AbCdEf' },

        // Secret 안에 여러 key가 있고 그중 하나만 매핑하고 싶을 때
        // { envVarName: 'DB_PASSWORD', existingSecretArn: '...', jsonField: 'password' },
      ],

      environmentVariables: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug',
      },

      // 앱이 실행 중 필요로 하는 AWS 권한 (예: S3 접근)
      // taskRolePolicyStatements: [
      //   { actions: ['s3:GetObject'], resources: ['arn:aws:s3:::my-bucket/*'] },
      // ],

      // 로그 수집기, APM 에이전트 등 사이드카가 필요할 때
      // sidecars: [
      //   { name: 'log-router', image: 'amazon/aws-for-fluent-bit:latest' },
      // ],

      logRetention: logs.RetentionDays.ONE_WEEK,

      // 운영 VPC는 보통 Private Subnet(NAT)을 씀 — 기본값 그대로 두면 됨.
      // Default VPC처럼 Public Subnet만 있는 환경(개인 테스트 등)에서는 아래처럼 전환:
      // network: { subnetType: 'PUBLIC', assignPublicIp: true },

      autoScaling: {
        minCapacity: 2,
        maxCapacity: 10,
        targetCpuUtilization: 70,
      },
    },
  ],
};
