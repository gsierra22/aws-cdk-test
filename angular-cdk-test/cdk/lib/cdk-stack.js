const { Stack, RemovalPolicy, SecretValue } = require('aws-cdk-lib');
const s3 = require('aws-cdk-lib/aws-s3');
const cloudfront = require('aws-cdk-lib/aws-cloudfront');
const origins = require('aws-cdk-lib/aws-cloudfront-origins');
const codepipeline = require('aws-cdk-lib/aws-codepipeline');
const actions = require('aws-cdk-lib/aws-codepipeline-actions');
const codebuild = require('aws-cdk-lib/aws-codebuild');

class CdkStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // 1. Private S3 Bucket
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // 2. CloudFront Distribution
    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
    });

    // 3. Pipeline Artifacts & Source
    const sourceOutput = new codepipeline.Artifact();
    const buildOutput = new codepipeline.Artifact();

    const sourceAction = new actions.GitHubSourceAction({
      actionName: 'GitHub_Source',
      owner: 'YOUR_GITHUB_USERNAME',
      repo: 'YOUR_REPOSITORY_NAME',
      branch: 'main',
      oauthToken: SecretValue.secretsManager('github-token'),
      output: sourceOutput,
    });

    // 4. CodeBuild Action to Deploy to S3 & Invalidate Cache
    const buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
      environment: { buildImage: codebuild.LinuxBuildImage.STANDARD_7_0 },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          build: {
            commands: [
              'aws s3 sync ./src s3://' + siteBucket.bucketName + ' --delete',
              'aws cloudfront create-invalidation --distribution-id ' + distribution.distributionId + ' --paths "/*"'
            ],
          },
        },
      }),
    });

    siteBucket.grantReadWrite(buildProject);
    distribution.grantHttpInvalidation(buildProject);

    // 5. CodePipeline
    new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: 'WebsitePipeline',
      stages: [
        { stageName: 'Source', actions: [sourceAction] },
        { stageName: 'Deploy', actions: [
            new actions.CodeBuildAction({
              actionName: 'Deploy_To_S3',
              project: buildProject,
              input: sourceOutput,
              outputs: [buildOutput],
            })
          ] 
        },
      ],
    });
  }
}

module.exports = { CdkStack };