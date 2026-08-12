import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';

export interface EcrStackProps extends cdk.StackProps {
  repositoryName: string;
  // true면 이미 존재하는 ECR을 조회만 함 (신규 생성 X)
  importExisting?: boolean;
}

export class EcrStack extends cdk.Stack {
  public readonly repository: ecr.IRepository;

  constructor(scope: Construct, id: string, props: EcrStackProps) {
    super(scope, id, props);

    this.repository = props.importExisting
      ? ecr.Repository.fromRepositoryName(this, 'Repository', props.repositoryName)
      : new ecr.Repository(this, 'Repository', {
          repositoryName: props.repositoryName,

          // 이미지 스캔 활성화 (보안 취약점 자동 검사)
          imageScanOnPush: true,

          // 이미지 자동 삭제 정책 (최근 10개만 유지)
          lifecycleRules: [
            {
              description: 'Keep only 10 images',
              maxImageCount: 10,
              rulePriority: 1,
            },
          ],

          // 스택 삭제 시 Repository도 함께 삭제 (개발 환경용)
          // Production에서는 RETAIN으로 변경 권장
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

    // Repository URI를 Output으로 출력
    new cdk.CfnOutput(this, 'RepositoryUri', {
      value: this.repository.repositoryUri,
      exportName: `${props.repositoryName}-RepositoryUri`,
    });

    new cdk.CfnOutput(this, 'RepositoryArn', {
      value: this.repository.repositoryArn,
      exportName: `${props.repositoryName}-RepositoryArn`,
    });
  }
}
