# aws.ps1 — AWS EKS (managed services overlay)

param(
    $Context,
    [string]$AwsRegion = '',
    [string]$EksCluster = '',
    [switch]$DryRun
)

Write-Host "AWS — EKS + managed services overlay" -ForegroundColor Cyan

$region = if ($AwsRegion) { $AwsRegion } elseif ($env:AWS_REGION) { $env:AWS_REGION } else { '' }
$cluster = if ($EksCluster) { $EksCluster } elseif ($env:EKS_CLUSTER_NAME) { $env:EKS_CLUSTER_NAME } else { '' }

if (-not $region -or -not $cluster) {
    Write-Host "  Set AWS_REGION and EKS_CLUSTER_NAME, or pass -AwsRegion / -EksCluster" -ForegroundColor Yellow
    Write-Host "  See ops/deploy/CLOUD.md for the cheapest AWS layout." -ForegroundColor Yellow
    exit 1
}

aws eks update-kubeconfig --region $region --name $cluster
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($DryRun) {
    kubectl kustomize k8s/overlays/aws --load-restrictor LoadRestrictionsNone
    exit 0
}

kubectl apply -k k8s/overlays/aws --load-restrictor LoadRestrictionsNone
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "  Applied k8s/overlays/aws. Patch RDS/MSK/Redis endpoints in configmap-infra-patch.yaml." -ForegroundColor Green
