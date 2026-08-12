# ECR + ECS Fargate CDK 자동화

새 컨테이너 서비스가 필요할 때 콘솔에서 수동으로 ECR/Task Definition/Service를 만들던 작업을 CDK로 대체하는 프로젝트입니다.

## 🎯 현재 범위

- ✅ **ECR 저장소 생성** (신규 생성 또는 `ecrImportExisting: true`로 기존 저장소 재사용)
- ✅ **ECS Fargate**: Cluster, Task Definition, Service, ALB
- ✅ **Task Definition 옵션**: Secrets Manager 연동(신규/기존 재사용), 사이드카 컨테이너, Task Role 커스텀 권한, 로그 보존기간, ephemeral storage, Public/Private 네트워크 선택
- ⏸ **CodeCommit / CodeBuild / CodePipeline 연동은 아직 범위 밖**입니다. 고객마다 이미 존재하는 파이프라인 구조가 다르고 buildspec 위치, IAM 권한 범위 등을 프로젝트별로 확인해야 해서, 확인 후 별도로 연동합니다. (`lib/pipeline-stack.ts`에 초안이 있으나 `bin/app.ts`에서 아직 사용하지 않습니다)

## 🏗 아키텍처

```
(기존) CodeCommit → CodeBuild → ECR ← [이 프로젝트가 자동 생성]
                                  ↓
                          ECS Fargate ← ALB ← Internet   [이 프로젝트가 자동 생성]
```

- **VPC**: 계정마다 이미 VPC가 하나씩 있는 구조라, CDK가 새로 만들지 않고 `fromLookup`으로 조회만 합니다.
- **ECS 클러스터/ALB**: 서비스(컨테이너)마다 각각 생성합니다 (MSA — 컨테이너 서비스 1개 = ECR/ECS 1개 매핑).

## 📦 사전 요구사항

- Node.js 18 이상
- AWS CLI 설치 및 자격증명 설정 (`aws configure` 또는 SSO)
- Docker (샘플 이미지 push 시 필요)

## 🚀 설치

```bash
npm install
```

## ⚙️ 설정 (`config/dev.ts`)

```typescript
export const devConfig: EnvironmentConfig = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT || 'YOUR_ACCOUNT_ID',
    region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-2',
  },

  // vpcId를 지정하면 그 VPC를 조회, 비워두면 계정의 Default VPC를 조회합니다.
  // vpcId: 'vpc-0123456789abcdef0',

  apps: [
    {
      name: 'api-server',
      containerPort: 8080,
      repository: 'api-server-repo',

      secrets: [
        // 신규 생성 (빈 값으로 만들어짐, 배포 후 콘솔에서 실제 값 입력)
        { envVarName: 'OPENAI_API_KEY', secretName: 'api-server/OPENAI_API_KEY' },
        // 이미 있는 Secret 재사용
        // { envVarName: 'EXTERNAL_API_KEY', existingSecretArn: 'arn:aws:secretsmanager:...' },
      ],

      // 운영 VPC는 보통 Private Subnet 사용 (기본값). Default VPC처럼 Private Subnet이
      // 없는 환경(개인 테스트 등)에서는 아래처럼 전환:
      // network: { subnetType: 'PUBLIC', assignPublicIp: true },

      autoScaling: { minCapacity: 2, maxCapacity: 10, targetCpuUtilization: 70 },
    },
  ],
};
```

`AppConfig`에서 지원하는 전체 옵션은 `config/types.ts` 참고 (사이드카, Task Role 권한, ephemeral storage, 로그 보존기간 등).

## 📤 배포 (상세는 `DEPLOYMENT.md` 참고)

```bash
npx cdk bootstrap          # 계정당 최초 1회
npx cdk synth               # 사전 점검
npx cdk deploy VpcStack
npx cdk deploy ApiServerEcrStack

# ECR에 초기 이미지 1개는 수동 push 필요 (닭과 달걀 문제, DEPLOYMENT.md 참고)

npx cdk deploy ApiServerEcsStack
```

## 🧪 테스트

오프라인 유닛 테스트부터 개인 AWS 계정으로 실제 배포까지 검증하는 전체 절차는 `TESTING.md` 참고. 요약하면:

```bash
npm run build   # 타입 체크
npm test        # AWS 계정 없이 오프라인으로 CDK 합성 결과 검증
```

`test/ecs-stack.test.ts`는 `aws-cdk-lib/assertions`로 실제 AWS 자격증명 없이 CloudFormation 템플릿을 검증합니다. Secrets/사이드카/네트워크 옵션 등을 바꿀 때마다 케이스를 추가하세요.

실제 배포 검증(=진짜 AWS 자원이 뜨는지)은 `Vpc.fromLookup`이 실제 API를 호출하기 때문에 AWS 계정이 반드시 필요합니다.

## 📁 구조

```
cdk-ecs-pipe/
├── bin/app.ts                  # CDK 앱 진입점 (Vpc → Ecr → Ecs 순으로 생성)
├── lib/
│   ├── vpc-stack.ts            # 기존 VPC 조회 (생성 X)
│   ├── ecr-stack.ts            # ECR 저장소
│   ├── ecs-stack.ts            # ECS Cluster/TaskDefinition/Service/ALB
│   └── pipeline-stack.ts       # 파이프라인 연동 초안 (아직 미사용)
├── config/
│   ├── types.ts                # AppConfig 등 타입 정의
│   └── dev.ts                  # Dev 환경 설정
├── test/ecs-stack.test.ts      # 오프라인 CDK 유닛 테스트
├── sample-app/                 # 테스트용 Node.js 앱 (ECR 초기 이미지용)
├── customer-questions.md       # 고객 확인용 질문 목록
├── DEPLOYMENT.md               # 운영 배포 절차
├── TESTING.md                  # 유닛 테스트 + 개인 계정 실배포 검증 절차
├── STACKS.md                   # 스택별 상세 설명, 옵션, 주의사항
└── README.md
```

## 🎯 다음 단계

- 고객 기존 CodePipeline 구조 확인 후 (`customer-questions.md` 참고) `pipeline-stack.ts` 연동
- Production 환경(`config/prod.ts`) 분리
