import * as path from 'node:path';
import * as fs from 'node:fs';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

// Every top-level *.html in this directory gets deployed to the bucket root.
const CONTENT_DIR = path.join(__dirname, '..', '..', 'plan');

export class SiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'SiteBucket', {
      websiteIndexDocument: 'index.html',
      publicReadAccess: true,
      // Allow a public bucket policy but keep ACLs blocked.
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: true,
        ignorePublicAcls: true,
        blockPublicPolicy: false,
        restrictPublicBuckets: false,
      }),
      // Shareable pages only — let `cdk destroy` clean up everything.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Voting backend: one table shared by every plan page, keyed by (poll, voter).
    const votes = new dynamodb.Table(this, 'VotesTable', {
      partitionKey: { name: 'poll', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'voter', type: dynamodb.AttributeType.STRING },
      // Provisioned 5/5 stays inside DynamoDB's always-free 25 RCU/WCU.
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: 5,
      writeCapacity: 5,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const voteFn = new lambda.Function(this, 'VoteFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda')),
      environment: { TABLE_NAME: votes.tableName },
    });
    votes.grantReadWriteData(voteFn);

    // Function URL instead of API Gateway: public HTTPS endpoint with no
    // per-request charge beyond Lambda's always-free 1M invocations/month.
    const voteUrl = voteFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.POST],
        allowedHeaders: ['content-type'],
      },
    });

    // Single source of truth for rule numbers (workout target, streak/wave tiers),
    // also imported by the Lambda — merged into config.json so pages read the same values.
    const lockinConfig = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'lambda', 'lockin-config.json'), 'utf8'),
    );

    new s3deploy.BucketDeployment(this, 'DeployPlans', {
      sources: [
        s3deploy.Source.asset(CONTENT_DIR, {
          exclude: ['*', '!*.html'],
        }),
        // Pages fetch this at runtime: voting endpoint + the shared rule numbers.
        s3deploy.Source.jsonData('config.json', { voteApiUrl: voteUrl.url, ...lockinConfig }),
      ],
      destinationBucket: bucket,
      // Default prune:true keeps the bucket in sync — deleting a local
      // .html removes it from the bucket on the next deploy.
    });

    new cdk.CfnOutput(this, 'BaseUrl', {
      value: `https://${bucket.bucketRegionalDomainName}/`,
      description: 'Share links as <BaseUrl><filename>.html, e.g. .../gokart-proposal.html',
    });

    new cdk.CfnOutput(this, 'BucketName', {
      value: bucket.bucketName,
    });

    new cdk.CfnOutput(this, 'VoteApiUrl', {
      value: voteUrl.url,
      description: 'Voting endpoint (GET ?poll=<id>, POST {poll, voter, track, date})',
    });
  }
}
