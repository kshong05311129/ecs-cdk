import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface VpcStackProps extends cdk.StackProps {
  // 지정하면 해당 VPC를 조회, 없으면 태그로 조회, 둘 다 없으면 계정의 기본(default) VPC 조회
  vpcId?: string;
  vpcTags?: { [key: string]: string };
}

export class VpcStack extends cdk.Stack {
  public readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id: string, props: VpcStackProps) {
    super(scope, id, props);

    // 계정마다 이미 사용 중인 VPC가 하나 있는 구조 → 새로 만들지 않고 조회만 함
    if (props.vpcId) {
      this.vpc = ec2.Vpc.fromLookup(this, 'Vpc', { vpcId: props.vpcId });
    } else if (props.vpcTags) {
      this.vpc = ec2.Vpc.fromLookup(this, 'Vpc', { tags: props.vpcTags });
    } else {
      // 개인 샌드박스 계정 등 별도 설정이 없을 때: 모든 AWS 계정에 기본으로 존재하는 Default VPC 사용
      this.vpc = ec2.Vpc.fromLookup(this, 'Vpc', { isDefault: true });
    }

    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
    });
  }
}
