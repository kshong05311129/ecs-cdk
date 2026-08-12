import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { EcrStack } from '../lib/ecr-stack';

const TEST_ENV = { account: '111111111111', region: 'ap-northeast-2' };

describe('EcrStack', () => {
  test('기본값(신규 생성)이면 ECR 저장소가 새로 만들어진다', () => {
    const app = new cdk.App();
    const stack = new EcrStack(app, 'TestEcrStackNew', {
      env: TEST_ENV,
      repositoryName: 'api-server-repo',
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::ECR::Repository', 1);
    template.hasResourceProperties('AWS::ECR::Repository', {
      RepositoryName: 'api-server-repo',
    });
  });

  test('importExisting이 true면 새로 생성하지 않고 조회만 한다', () => {
    const app = new cdk.App();
    const stack = new EcrStack(app, 'TestEcrStackImport', {
      env: TEST_ENV,
      repositoryName: 'api-server-repo',
      importExisting: true,
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::ECR::Repository', 0);
    // 조회로 가져와도 Output은 정상적으로 계산된 URI를 출력한다
    template.hasOutput('RepositoryUri', {});
  });
});
