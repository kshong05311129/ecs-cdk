# 테스트 가이드

이 프로젝트를 검증하는 방법은 두 단계입니다. 코드만 바꿨다면 1단계로 충분하고, 실제로 배포까지 확인하고 싶으면 2단계(개인 AWS 계정 필요)를 진행하세요.

## 1단계: 오프라인 유닛 테스트 (AWS 계정 불필요)

```bash
npm run build   # 타입 체크
npm test        # CDK가 만들어낼 CloudFormation을 메모리에서 검증
```

`test/ecs-stack.test.ts`가 실제 AWS 자격증명 없이 Secrets/사이드카/네트워크 옵션 등이 의도대로 합성되는지 확인합니다. `config/types.ts`나 `lib/ecs-stack.ts`를 바꿀 때마다 먼저 이걸로 검증하세요.

## 2단계: 개인 AWS 계정으로 실제 배포 검증

AWS 계정이 있다면 순서대로 따라 하시면 됩니다.

### 0. 로컬에 자격증명이 연결되어 있는지, 어느 계정/리전인지 확인

```bash
aws sts get-caller-identity   # 계정 ID 확인 — 의도한 계정(개인 테스트 계정)이 맞는지 꼭 확인
aws configure get region      # 리전 확인 — config/dev.ts의 region과 다르면 맞춰줄 것
```

계정 정보가 나오면 OK. 에러 나면 아직 로컬에 로그인 정보가 없는 거니 `aws configure`로 Access Key/Secret Key/Region을 먼저 등록하세요. 엉뚱한 계정(예: 회사 계정)으로 잘못 배포하는 걸 막기 위한 습관이니 매번 확인하세요.

### 1. `config/dev.ts` 딱 두 곳만 확인

- 계정 ID는 손댈 필요 없습니다 — CDK가 지금 로그인된 계정을 자동으로 씁니다.
- **VPC**: `vpcId`를 안 적으면 그 계정의 Default VPC를 자동으로 씁니다. 이 경우 아래 줄 주석을 꼭 풀어주세요 (Default VPC는 보통 Private Subnet이 없어서):

```typescript
network: { subnetType: 'PUBLIC', assignPublicIp: true },
```

### 2. CDK Bootstrap (계정당 최초 1회만)

```bash
cd "/Users/kshong/Documents/서브원/cdk-ecs-pipe"
npx cdk bootstrap
```

### 3. 사전 점검 (문제 있는지 미리 확인)

```bash
npx cdk synth
```

여기서 처음으로 실제 AWS에 VPC 조회 요청이 나갑니다. 에러 없이 템플릿이 출력되면 다음 단계로.

### 4. VPC → ECR 순서로 배포

```bash
npx cdk deploy VpcStack
npx cdk deploy ApiServerEcrStack
```

`ApiServerEcrStack` 배포가 끝나면 `RepositoryUri` 값이 출력됩니다 — 다음 단계에서 씁니다.

### 5. 샘플 이미지 빌드 & push (ECS 배포 전에 이미지가 있어야 함)

Docker Desktop이 켜져있어야 합니다.

```bash
aws ecr get-login-password --region ap-northeast-2 | docker login --username AWS --password-stdin <RepositoryUri 앞부분(계정ID.dkr.ecr...)>

cd sample-app
docker build -t api-server-repo .
docker tag api-server-repo:latest <RepositoryUri>:latest
docker push <RepositoryUri>:latest
cd ..
```

### 6. ECS 배포

```bash
npx cdk deploy ApiServerEcsStack
```

배포 끝나면 `LoadBalancerDNS`가 출력됩니다.

### 7. 동작 확인

```bash
curl http://<LoadBalancerDNS>/health
```

`{"status":"ok",...}` 나오면 성공입니다.

### 8. 끝나면 비용 방지 위해 정리

```bash
npx cdk destroy ApiServerEcsStack
npx cdk destroy ApiServerEcrStack
```

`VpcStack`은 리소스를 생성하지 않고 조회만 하므로 destroy해도 실제 VPC는 삭제되지 않습니다 (그대로 둬도 무방).

## 참고

- `npx cdk list`로 지금 배포 대상 스택 목록만 빠르게 확인 가능 (`VpcStack`, `ApiServerEcrStack`, `ApiServerEcsStack` 세 개만 나와야 정상 — CodeBuild/CodePipeline은 이 프로젝트 범위 밖이라 여기 안 나옵니다)
- 상세 트러블슈팅은 `DEPLOYMENT.md` 참고
