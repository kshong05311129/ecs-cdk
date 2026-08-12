# 배포 가이드

현재 이 CDK 앱이 만드는 건 **VPC 조회 + ECR + ECS(Task Definition/Service/ALB)** 까지입니다.
CodeCommit/CodeBuild/CodePipeline은 이 가이드에 포함되지 않습니다 (아직 연동 전).

## 📋 배포 전 체크리스트

- [ ] Node.js 18 이상 설치
- [ ] AWS CLI 설치 및 자격증명 설정 (`aws sts get-caller-identity`로 확인)
- [ ] 지금 연결된 계정/리전이 의도한 곳이 맞는지 확인 (3단계 참고)
- [ ] Docker 설치 (초기 이미지 push용)
- [ ] `npm install` 완료

## 🚀 단계별 배포

### 1. 의존성 설치 & 타입 체크

```bash
npm install
npm run build
```

### 2. 설정 확인 (`config/dev.ts`)

- 계정 ID는 보통 손댈 필요 없음 — CDK가 현재 로그인된 계정을 자동으로 씁니다.

**VPC 지정 (`vpcId`)**

`EnvironmentConfig` 최상단의 `vpcId` 필드 하나로 정해집니다 (앱마다가 아니라 계정 전체 설정 한 곳). 원하는 VPC가 있으면 이 필드에 지정하세요:

```typescript
vpcId: 'vpc-0123456789abcdef0',
```

VPC ID를 모르면 아래로 목록을 확인할 수 있습니다:

```bash
aws ec2 describe-vpcs --query 'Vpcs[].{ID:VpcId,CIDR:CidrBlock,IsDefault:IsDefault,Name:Tags[?Key==`Name`].Value|[0]}' --output table
```

- **`vpcId`를 비워두면** 계정의 **Default VPC**를 조회합니다.
  - Default VPC는 보통 Private Subnet이 없으므로, 이 경우 앱 설정에서 아래 줄 주석을 해제하세요:
    ```typescript
    network: { subnetType: 'PUBLIC', assignPublicIp: true },
    ```
- **원하는 VPC를 `vpcId`로 직접 지정한 경우**, 보통 그 VPC엔 이미 Private Subnet(NAT)이 갖춰져 있으므로 `network` 설정은 생략(기본값 Private)하면 됩니다. `network.subnetType: 'PUBLIC'`은 Default VPC 테스트용 옵션이니, 지정한 VPC를 쓸 땐 주석 처리된 채로 두세요.

### 3. 지금 어떤 계정/리전으로 배포되는지 확인 (중요)

`cdk bootstrap`/`cdk deploy`는 **현재 터미널에 연결된 AWS 자격증명 기준으로** 바로 리소스를 만듭니다. 엉뚱한 계정(예: 회사 계정)에 실수로 배포하는 걸 막으려면 매번 이 단계로 확인하는 습관을 들이세요.

```bash
aws sts get-caller-identity   # 계정 ID, ARN(어떤 사용자/역할인지) 확인
aws configure get region      # 기본 리전 확인
echo $AWS_PROFILE              # 여러 프로파일을 쓴다면, 지금 어떤 프로파일인지 확인
```

- `Account` 값이 의도한 계정(개인 테스트 계정)이 맞는지 확인하세요.
- 리전이 `config/dev.ts`의 `region`(기본 `ap-northeast-2`)과 다르면, `aws configure set region ap-northeast-2`로 맞추거나 `config/dev.ts`의 리전 값을 실제 쓰려는 리전으로 바꾸세요.
- 여러 AWS 계정을 관리 중이면 `aws configure list-profiles`로 프로파일 목록을 보고 `--profile <이름>` 또는 `AWS_PROFILE=<이름>`을 명시적으로 지정하는 걸 권장합니다.

### 4. CDK Bootstrap (계정당 최초 1회)

```bash
npx cdk bootstrap
```

실행하면 "Bootstrapping environment aws://<계정ID>/<리전>..." 이라는 문구가 뜹니다. 여기 나온 계정ID/리전이 3단계에서 확인한 값과 일치하는지 한 번 더 보세요.

### 5. 사전 점검

```bash
npx cdk synth
```

이 시점에 실제 AWS로 VPC 조회 요청이 나갑니다. 에러 없이 템플릿이 출력되면 다음 단계로 진행하세요.

### 6. VPC → ECR 배포

```bash
npx cdk deploy VpcStack
npx cdk deploy ApiServerEcrStack
```

`ApiServerEcrStack` 배포 완료 시 `RepositoryUri`가 출력됩니다.

### 7. 초기 Docker 이미지 업로드 (수동, 최초 1회)

ECS는 ECR에 이미지가 최소 1개 있어야 서비스가 정상적으로 뜹니다. 이 과정은 자동화 대상이 아닙니다(파이프라인이 아직 없으니 최초 이미지는 사람이 올려야 함).

```bash
aws ecr get-login-password --region ap-northeast-2 | \
  docker login --username AWS --password-stdin \
  $(aws sts get-caller-identity --query Account --output text).dkr.ecr.ap-northeast-2.amazonaws.com

cd sample-app
docker build -t api-server-repo .
docker tag api-server-repo:latest \
  $(aws sts get-caller-identity --query Account --output text).dkr.ecr.ap-northeast-2.amazonaws.com/api-server-repo:latest
docker push \
  $(aws sts get-caller-identity --query Account --output text).dkr.ecr.ap-northeast-2.amazonaws.com/api-server-repo:latest
cd ..
```

### 8. ECS 배포

```bash
npx cdk deploy ApiServerEcsStack
```

`LoadBalancerDNS`가 출력됩니다.

### 9. Secret 값 설정 (secrets를 신규 생성한 경우)

배포 시점엔 빈 placeholder 값으로 생성됩니다. 실제 값 입력:

```bash
aws secretsmanager update-secret \
  --secret-id api-server/OPENAI_API_KEY \
  --secret-string '{"OPENAI_API_KEY":"sk-your-actual-key-here"}'
```

`existingSecretArn`으로 기존 Secret을 재사용한 경우엔 이 단계가 필요 없습니다.

### 10. 동작 확인

```bash
ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name ApiServerEcsStack \
  --query "Stacks[0].Outputs[?OutputKey=='LoadBalancerDNS'].OutputValue" \
  --output text)

curl http://$ALB_DNS/health
curl http://$ALB_DNS/api/test
```

## 🔄 코드/설정 변경 후 재배포

```bash
npm run build
npx cdk deploy ApiServerEcsStack
```

새 이미지를 올린 뒤 서비스를 다시 배포하려면(현재는 자동 파이프라인이 없으므로):

```bash
aws ecs update-service \
  --cluster api-server-cluster \
  --service api-server-service \
  --force-new-deployment
```

## 🗑 리소스 정리 (비용 방지)

```bash
npx cdk destroy ApiServerEcsStack
npx cdk destroy ApiServerEcrStack
```

`VpcStack`은 리소스를 생성하지 않고 조회만 하므로 destroy해도 실제 VPC는 삭제되지 않습니다 (그대로 둬도 무방).

## 🛠 트러블슈팅

### ECS 태스크가 계속 재시작됨

```bash
aws logs tail /ecs/api-server --follow
aws ecs describe-services --cluster api-server-cluster --services api-server-service
```
보통 헬스체크 실패(`/health` 응답 없음) 또는 ECR에 이미지가 없는 경우입니다.

### `cdk synth`에서 VPC를 못 찾는다는 에러

- `vpcId`를 잘못 지정했거나, Default VPC가 없는 계정(직접 삭제한 경우)일 수 있습니다.
- `aws ec2 describe-vpcs`로 실제 VPC 목록을 확인하고 `vpcId`를 명시하세요.

### ALB로 접속이 안 됨

```bash
aws elbv2 describe-target-health --target-group-arn <TARGET_GROUP_ARN>
```
Target이 `unhealthy`면 컨테이너가 `/health`에서 200을 안 주고 있다는 뜻 — 컨테이너 로그를 먼저 확인하세요.

## 🔒 보안 체크리스트

- [ ] Secrets Manager에 실제 값 설정 완료
- [ ] ALB는 아직 HTTP만 지원 — 운영 반영 전 HTTPS(ACM 인증서) 추가 검토
- [ ] ECR 이미지 스캔 활성화됨 (기본 적용)
- [ ] `network.subnetType`을 운영에서는 Private로 유지 (Public은 테스트용)
