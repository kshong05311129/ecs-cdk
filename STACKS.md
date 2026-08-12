# 스택별 상세 설명

각 스택이 정확히 뭘 하는지, 어떤 설정을 읽는지, 헷갈리기 쉬운 부분(캐비엇)을 정리합니다.
공통 원칙: **CDK는 "있으면 조회, 없으면 생성"을 자동으로 판단해주지 않습니다.** 아래 각 스택의 "조회 vs 생성" 옵션은 전부 사람이 config에 직접 참/거짓으로 지정해줘야 하는 값입니다.

---

## `VpcStack` (`lib/vpc-stack.ts`)

**역할**: 계정에 이미 있는 VPC를 조회만 함. 새로 만들지 않습니다.

**읽는 설정**: `EnvironmentConfig.vpcId`, `EnvironmentConfig.vpcTags` (`config/dev.ts` 최상단, 앱마다가 아니라 계정 전체 설정 1곳)

**동작**:
- `vpcId` 지정 → 그 VPC ID로 조회
- `vpcId` 없고 `vpcTags` 있음 → 태그로 조회
- 둘 다 없음 → 계정의 Default VPC 조회

**만드는 리소스**: 사실상 없음 (CfnOutput 하나뿐). `Vpc.fromLookup()`은 CDK CLI가 배포 전에 AWS API로 직접 조회해서 결과를 `cdk.context.json`에 캐싱하는 방식이라, CloudFormation에 새로 올라가는 리소스가 없습니다.

**주의할 점**:
- Default VPC(태그/ID 미지정 시)는 보통 Private Subnet이 없습니다 → 이 경우 각 앱의 `network.subnetType`을 `'PUBLIC'`으로 바꿔야 `EcsStack` 배포가 됩니다.
- `vpcId`를 잘못 입력하면 `cdk synth` 단계에서 바로 에러가 납니다 (조회 실패).

---

## `EcrStack` (`lib/ecr-stack.ts`)

**역할**: 컨테이너 이미지 저장소(ECR)를 준비. 앱마다 하나씩.

**읽는 설정**: `AppConfig.repository` (저장소 이름), `AppConfig.ecrImportExisting`

**동작**:
| `ecrImportExisting` | 동작 |
|---|---|
| `true` | 신규 생성 안 함. `ecr.Repository.fromRepositoryName()`으로 조회만 |
| `false` / 미지정 (기본값) | `new ecr.Repository()`로 신규 생성 (이미지 스캔 활성화, 최근 10개만 보관, 스택 삭제 시 같이 삭제) |

**주의할 점 — 이 값은 사람이 정확히 알고 맞게 설정해야 합니다:**

| 실제 ECR 존재 여부 | `ecrImportExisting` | 결과 |
|---|---|---|
| 있음 | `true` (맞음) | 정상 |
| 없음 | `false`/미지정 (맞음) | 정상 |
| **있음** | `false`/미지정 (**틀림**) | 배포 에러 — "이미 존재하는 이름" |
| **없음** | `true` (**틀림**) | 조회 자체는 되지만, 나중에 이미지 push/ECS 배포 시점에 에러 |

---

## `EcsStack` (`lib/ecs-stack.ts`)

**역할**: ECS Cluster, Task Definition, Fargate Service, ALB를 앱마다 새로 생성. **클러스터/서비스는 항상 신규 생성만 지원**하며(조회 옵션 없음 — 의도적으로 제외한 상태, 필요해지면 `ecrImportExisting`과 같은 패턴으로 추가 가능), Task Definition에 들어가는 이미지는 `EcrStack`에서 만든/조회한 ECR의 `latest` 태그를 참조합니다.

**읽는 설정**: `AppConfig` 대부분

| 옵션 | 역할 |
|---|---|
| `containerPort`, `cpu`, `memory`, `desiredCount` | 기본 Task/Service 설정 |
| `secrets` | Secrets Manager 연동. `existingSecretArn` 있으면 재사용, 없으면 신규 생성(빈 값, 배포 후 콘솔에서 입력 필요). `jsonField`로 특정 key만 매핑 가능 |
| `environmentVariables` | 고정 환경변수 |
| `taskRolePolicyStatements` | 앱이 실행 중 필요로 하는 추가 AWS 권한 (S3 등) |
| `sidecars` | 로그 수집기 등 컨테이너 추가 |
| `ephemeralStorageGiB` | 미지정 시 Fargate 기본값(20GiB) |
| `logRetention` | 미지정 시 1주일 |
| `network.subnetType` | 기본 `PRIVATE_WITH_EGRESS`(운영용). `PUBLIC`은 Default VPC 테스트용 |
| `autoScaling` | CPU/메모리 기반 오토스케일링 (미지정 시 오토스케일링 없음) |

**주의할 점**:
- **이미지가 먼저 있어야 합니다.** `ecs.ContainerImage.fromEcrRepository(repository, 'latest')`로 고정되어 있어서, ECR에 `latest` 태그 이미지가 없으면 배포는 되지만 태스크가 계속 실패/재시작합니다. (`EcrStack` 배포 → 이미지 push → `EcsStack` 배포 순서 필수)
- 클러스터/ALB는 **항상 새로 만들어집니다.** 이미 있는 클러스터에 서비스만 추가하는 기능은 지금 없습니다 (필요해지면 논의 후 추가).

---

## `PipelineStack` (`lib/pipeline-stack.ts`) — 미사용

`bin/app.ts`에서 아직 호출하지 않습니다. CodeCommit/CodeBuild/CodePipeline을 처음부터 새로 만드는 초안 코드만 남아있고, 고객 기존 파이프라인 구조 확인 후(`customer-questions.md` 참고) 연동 방식을 다시 설계할 예정입니다.
