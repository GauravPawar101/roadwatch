$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$MessagingTopologyPath = Join-Path $RepoRoot 'config\messaging-topology.json'

function Get-MessagingTopology {
    if (-not (Test-Path $MessagingTopologyPath)) {
        throw "Missing messaging topology manifest: $MessagingTopologyPath"
    }

    return Get-Content -Raw -Path $MessagingTopologyPath | ConvertFrom-Json
}

function Wait-ForKafkaBroker {
    param(
        [string]$BootstrapServer,
        [int]$TimeoutSeconds = 180
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            & docker exec roadwatch_kafka kafka-topics --bootstrap-server $BootstrapServer --list | Out-Null
            if ($LASTEXITCODE -eq 0) {
                return
            }
        } catch {
        }

        Start-Sleep -Seconds 2
    }

    throw "Timed out waiting for Kafka broker at $BootstrapServer"
}

function Get-KafkaTopicPartitionCount {
    param(
        [string]$BootstrapServer,
        [string]$TopicName
    )

    $describeOutput = & docker exec roadwatch_kafka kafka-topics `
        --bootstrap-server $BootstrapServer `
        --describe `
        --topic $TopicName 2>$null

    if ($LASTEXITCODE -ne 0 -or -not $describeOutput) {
        return $null
    }

    foreach ($line in $describeOutput) {
        if ($line -match 'PartitionCount:\s*(\d+)') {
            return [int]$Matches[1]
        }
    }

    return $null
}

function Wait-ForKafkaTopicLeaders {
    param(
        [string]$BootstrapServer,
        [string[]]$TopicNames,
        [int]$TimeoutSeconds = 180
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $allReady = $true

        foreach ($topicName in $TopicNames) {
            $describeOutput = & docker exec roadwatch_kafka kafka-topics `
                --bootstrap-server $BootstrapServer `
                --describe `
                --topic $topicName 2>$null

            if ($LASTEXITCODE -ne 0 -or -not $describeOutput) {
                $allReady = $false
                break
            }

            foreach ($line in $describeOutput) {
                if ($line -match 'Partition:\s*(\d+).*Leader:\s*(none|-1)') {
                    $allReady = $false
                    break
                }
            }

            if (-not $allReady) {
                break
            }
        }

        if ($allReady) {
            return
        }

        Start-Sleep -Seconds 2
    }

    throw "Timed out waiting for Kafka topic leaders at $BootstrapServer"
}

function Initialize-KafkaTopics {
    $topology = Get-MessagingTopology
    $bootstrapServer = [string]$topology.kafka.bootstrapServer
    $replicationFactor = [string]$topology.kafka.replicationFactor

    Wait-ForKafkaBroker -BootstrapServer $bootstrapServer

    foreach ($topic in $topology.kafka.topics) {
        $topicName = [string]$topic.name
        $desiredPartitions = [int]$topic.partitions

        Write-Host "  • Ensuring Kafka topic $topicName ($desiredPartitions partitions)" -ForegroundColor Gray
        & docker exec roadwatch_kafka kafka-topics `
            --bootstrap-server $bootstrapServer `
            --create `
            --if-not-exists `
            --topic $topicName `
            --partitions $desiredPartitions `
            --replication-factor $replicationFactor

        if ($LASTEXITCODE -ne 0) {
            throw "Failed to ensure Kafka topic $topicName"
        }

        $currentPartitions = Get-KafkaTopicPartitionCount -BootstrapServer $bootstrapServer -TopicName $topicName
        if ($null -eq $currentPartitions) {
            throw "Kafka topic $topicName could not be described after initialization"
        }

        if ($currentPartitions -lt $desiredPartitions) {
            Write-Host "    ↳ Increasing partitions from $currentPartitions to $desiredPartitions" -ForegroundColor DarkGray
            & docker exec roadwatch_kafka kafka-topics `
                --bootstrap-server $bootstrapServer `
                --alter `
                --topic $topicName `
                --partitions $desiredPartitions

            if ($LASTEXITCODE -ne 0) {
                throw "Failed to alter Kafka topic $topicName to $desiredPartitions partitions"
            }
        } elseif ($currentPartitions -gt $desiredPartitions) {
            Write-Host "    ↳ Topic already has $currentPartitions partitions; leaving as-is because Kafka cannot shrink partitions" -ForegroundColor DarkGray
        }
    }

    Wait-ForKafkaTopicLeaders -BootstrapServer $bootstrapServer -TopicNames @($topology.kafka.topics | ForEach-Object { [string]$_.name })
}

function Initialize-Redis {
    $topology = Get-MessagingTopology

    Write-Host "⏳ Verifying Redis databases and key namespaces..." -ForegroundColor Blue
    foreach ($database in $topology.redis.databases) {
        $index = [int]$database.index
        $purpose = [string]$database.purpose
        Write-Host "  • Redis DB $index - $purpose" -ForegroundColor Gray

        & docker exec roadwatch_redis redis-cli -n $index ping | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Redis database $index is not responding"
        }
    }
}

Write-Host "⏳ Initializing Redis and Kafka messaging infrastructure..." -ForegroundColor Blue
Initialize-Redis
Initialize-KafkaTopics
Write-Host "✓ Redis and Kafka initialization complete" -ForegroundColor Green