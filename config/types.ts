import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';

export interface SecretMapping {
  // 컨테이너에 주입될 환경변수 이름
  envVarName: string;
  // 이미 만들어진 Secret을 재사용할 때 (신규 생성 X)
  existingSecretArn?: string;
  // 신규 생성할 때 Secret 이름 (기본값: `${appName}/${envVarName}`)
  secretName?: string;
  // Secret이 JSON이고 특정 key만 매핑하고 싶을 때
  jsonField?: string;
}

export interface SidecarContainerConfig {
  name: string;
  image: string;
  cpu?: number;
  memory?: number;
  essential?: boolean;
  containerPort?: number;
  environmentVariables?: { [key: string]: string };
}

export interface NetworkConfig {
  // 기본값은 PRIVATE_WITH_EGRESS (운영 환경 기준).
  // 대상 VPC에 Private Subnet/NAT가 없는 경우(예: 기본 VPC로 개인 테스트) PUBLIC으로 전환.
  subnetType?: 'PRIVATE_WITH_EGRESS' | 'PUBLIC';
  assignPublicIp?: boolean;
}

export interface AppConfig {
  name: string;
  containerPort: number;
  cpu?: number;
  memory?: number;
  desiredCount?: number;
  repository: string;
  // true면 이미 존재하는 ECR을 조회만 함 (신규 생성 X)
  ecrImportExisting?: boolean;

  secrets?: SecretMapping[];
  environmentVariables?: { [key: string]: string };

  // Task Role에 추가로 부여할 권한 (S3, DynamoDB 접근 등 앱이 실행 중 필요로 하는 권한)
  taskRolePolicyStatements?: iam.PolicyStatementProps[];

  ephemeralStorageGiB?: number; // 미지정 시 Fargate 기본값(20GiB) 사용
  logRetention?: logs.RetentionDays; // 미지정 시 ONE_WEEK

  sidecars?: SidecarContainerConfig[];

  network?: NetworkConfig;

  autoScaling?: {
    minCapacity: number;
    maxCapacity: number;
    targetCpuUtilization: number;
  };
}

export interface NotificationConfig {
  email?: string;
  slackWebhook?: string;
}

export interface EnvironmentConfig {
  env: {
    account: string;
    region: string;
  };
  // 계정당 VPC가 이미 하나 있는 구조 → CDK는 생성이 아니라 조회(lookup)만 함
  vpcId?: string;
  vpcTags?: { [key: string]: string };
  apps: AppConfig[];
  notification?: NotificationConfig;
}
