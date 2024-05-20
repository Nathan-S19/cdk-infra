import { Stack, Duration, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as autoScale from 'aws-cdk-lib/aws-autoscaling';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

export class EC2Stack extends Stack {
  /**
   *
   * @param {Construct} scope
   * @param {string} id
   * @param {StackProps} props
   */
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // Create a VPC
    const vpc = new ec2.Vpc(this, 'MyVpc', {
      maxAzs: 3,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Ingress',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Application',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 28,
          name: 'Database',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // Create an ECS cluster
    const ecsCluster = new ecs.Cluster(this, 'MyECSCluster', {
      vpc: vpc,
    });

    // adding EC2 Auto Scaling Group
    const ec2AutoScalingGroup = new autoScale.AutoScalingGroup(this, 'AppASG', {
      vpc: vpc,
      instanceType: new ec2.InstanceType('t4g.small'),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(ecs.AmiHardwareType.ARM),
      desiredCapacity: 1,
      minCapacity: 1,
      maxCapacity: 3,
    });

    const capacityProvider = new ecs.AsgCapacityProvider(
      this,
      'AppAsgCapacityProvider',
      {
        autoScalingGroup: ec2AutoScalingGroup,
      }
    );

    ecsCluster.addAsgCapacityProvider(capacityProvider);

    // creating ECS Task Definition
    const appTaskDefinition = new ecs.Ec2TaskDefinition(this, 'AppTaskDef', {
      family: 'AppTaskDef',
      executionRole: iam.Role.fromRoleArn(
        this,
        'ecs-execution-role',
        // Replace the ARN with your own ECS task execution role ARN
        'arn:aws:iam::123456789012:role/ecsTaskExecutionRole'
      ),
      networkMode: ecs.NetworkMode.AWS_VPC,
    });

    appTaskDefinition.addContainer('AppContainer', {
      image: ecs.ContainerImage.fromRegistry('amazon/amazon-ecs-sample'),
      portMappings: [
        {
          containerPort: 3000,
          protocol: ecs.Protocol.TCP,
        },
      ],
      memoryLimitMiB: 512,
      cpu: 256,
    });

    // creating ECS Service
    const appECSService = new ecs.Ec2Service(this, 'app-service', {
      cluster: ecsCluster,
      taskDefinition: appTaskDefinition,
    });

    // creating ALB
    const appLB = new elbv2.ApplicationLoadBalancer(this, 'AppLB', {
      vpc: vpc,
      internetFacing: true,
    });

    // adding a listener to ALB
    const listener = appLB.addListener('Listener', { port: 80 });
    // registering targets to ALB
    appECSService.registerLoadBalancerTargets({
      containerName: 'AppContainer',
      containerPort: 3000,
      newTargetGroupId: 'AppTargetGroup',
      listener: ecs.ListenerConfig.applicationListener(listener, {
        protocol: elbv2.ApplicationProtocol.HTTP,
      }),
    });
  }
}
