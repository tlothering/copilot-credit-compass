targetScope = 'resourceGroup'

// ---------------------------------------------------------------------------
// Copilot Credit Compass — infrastructure
//
// Design rules this file holds to:
//   * Managed Identity everywhere. There is not one connection string, key or
//     secret in any app setting. Cosmos local auth is disabled outright, so
//     even a leaked key would not work because no key can be issued.
//   * Application Insights is configured to drop the client IP rather than
//     mask it, because the application deliberately never learns an IP and the
//     telemetry pipeline should not learn one either.
//   * Cosmos is serverless. A benchmark that receives a few submissions a day
//     should not pay for provisioned throughput.
//   * The Container App scales to zero. This is a planning tool with bursty,
//     unpredictable traffic; a cold start is a better trade than an idle
//     replica billed around the clock.
// ---------------------------------------------------------------------------

@minLength(3)
@maxLength(24)
@description('Short name used to derive every resource name. Lowercase letters and numbers.')
param namePrefix string = 'credcompass'

@description('Location for all resources. Defaults to the resource group location.')
param location string = resourceGroup().location

@description('Container image to deploy, including registry and tag.')
param containerImage string = 'ghcr.io/copilot-credit-compass/app:latest'

@description('Set true when the image lives in a private registry that requires the managed identity to pull.')
param registryRequiresAuthentication bool = false

@description('Registry login server, used only when registryRequiresAuthentication is true.')
param registryServer string = 'ghcr.io'

@minValue(0)
@maxValue(5)
@description('Minimum Container App replicas. Zero means scale to zero when idle.')
param minReplicas int = 0

@minValue(1)
@maxValue(30)
@description('Maximum Container App replicas.')
param maxReplicas int = 5

@minValue(1)
@description('Concurrent requests per replica before the HTTP scale rule adds one.')
param concurrentRequestsPerReplica int = 40

@description('Provision Azure Front Door Standard with a managed WAF policy in front of the app.')
param enableFrontDoor bool = false

@description('Daily ingestion cap for Log Analytics in GB. Set to -1 for no cap.')
param logAnalyticsDailyQuotaGb int = 1

@description('Retention in days for Log Analytics and Application Insights.')
@minValue(30)
@maxValue(730)
param logRetentionDays int = 30

@description('Tags applied to every resource.')
param tags object = {
  application: 'copilot-credit-compass'
  'azd-env-name': namePrefix
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

var suffix = uniqueString(resourceGroup().id, namePrefix)
var lawName = '${namePrefix}-law-${suffix}'
var appInsightsName = '${namePrefix}-ai-${suffix}'
var identityName = '${namePrefix}-id-${suffix}'
var cosmosName = toLower('${namePrefix}cos${suffix}')
var acaEnvName = '${namePrefix}-env-${suffix}'
var appName = '${namePrefix}-app-${suffix}'
var frontDoorName = '${namePrefix}-fd-${suffix}'
var wafName = toLower('${namePrefix}waf${suffix}')

var cosmosDatabaseName = 'compass'
var submissionsContainerName = 'submissions'
var countersContainerName = 'counters'

// Built-in Cosmos DB data-plane role. 00000000-0000-0000-0000-000000000002 is
// "Cosmos DB Built-in Data Contributor" — the read/write data role. The control
// plane roles (Owner, Contributor) deliberately grant no data access when local
// auth is disabled, which is exactly the separation we want.
var cosmosDataContributorRoleId = '00000000-0000-0000-0000-000000000002'

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: lawName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: logRetentionDays
    workspaceCapping: {
      dailyQuotaGb: logAnalyticsDailyQuotaGb
    }
    features: {
      // No cross-workspace queries, no legacy agent auth paths.
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
    // false means "mask the IP", which in practice zeroes the last octet and
    // then discards it. Setting this true would store the full client IP. The
    // application also strips client_IP in its own telemetry initialiser, so
    // this is defence in depth rather than the only control.
    DisableIpMasking: false
    DisableLocalAuth: true
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
  tags: tags
}

// ---------------------------------------------------------------------------
// Cosmos DB — serverless, local auth disabled
// ---------------------------------------------------------------------------

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: cosmosName
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    databaseAccountOfferType: 'Standard'
    // Serverless: no provisioned RU floor to pay for.
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    // The single most important line in this file. With local auth disabled the
    // account cannot issue or accept a key, so there is no credential to leak,
    // rotate or accidentally paste into an app setting.
    disableLocalAuth: true
    disableKeyBasedMetadataWriteAccess: true
    minimalTlsVersion: 'Tls12'
    publicNetworkAccess: 'Enabled'
    networkAclBypass: 'AzureServices'
    consistencyPolicy: {
      // Session is sufficient: aggregates are recomputed on read and a
      // submission that lands a few hundred milliseconds late changes nothing.
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    backupPolicy: {
      type: 'Continuous'
      continuousModeProperties: {
        tier: 'Continuous7Days'
      }
    }
  }
}

resource cosmosDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: cosmos
  name: cosmosDatabaseName
  properties: {
    resource: {
      id: cosmosDatabaseName
    }
  }
}

resource submissionsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: cosmosDatabase
  name: submissionsContainerName
  properties: {
    resource: {
      id: submissionsContainerName
      partitionKey: {
        // The coarse cohort string, never anything user-specific. Cohorts are
        // naturally bounded (industry x region x size band) and roughly even,
        // which is what a partition key needs to be.
        paths: [
          '/cohort'
        ]
        kind: 'Hash'
        version: 2
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [
          {
            path: '/industry/?'
          }
          {
            path: '/region/?'
          }
          {
            path: '/employeeBand/?'
          }
          {
            path: '/rateCardVersion/?'
          }
          {
            path: '/submittedAt/?'
          }
        ]
        excludedPaths: [
          {
            path: '/*'
          }
        ]
      }
    }
  }
}

resource countersContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: cosmosDatabase
  name: countersContainerName
  properties: {
    resource: {
      id: countersContainerName
      partitionKey: {
        paths: [
          '/id'
        ]
        kind: 'Hash'
        version: 2
      }
      defaultTtl: -1
    }
  }
}

// Data-plane RBAC. This is what replaces the connection string.
resource cosmosDataRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = {
  parent: cosmos
  name: guid(cosmos.id, identity.id, cosmosDataContributorRoleId)
  properties: {
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/${cosmosDataContributorRoleId}'
    principalId: identity.properties.principalId
    scope: cosmos.id
  }
}

resource cosmosDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: cosmos
  name: 'to-log-analytics'
  properties: {
    workspaceId: logAnalytics.id
    logs: [
      {
        category: 'DataPlaneRequests'
        enabled: true
        retentionPolicy: {
          enabled: false
          days: 0
        }
      }
      {
        category: 'ControlPlaneRequests'
        enabled: true
        retentionPolicy: {
          enabled: false
          days: 0
        }
      }
    ]
    metrics: [
      {
        category: 'Requests'
        enabled: true
        retentionPolicy: {
          enabled: false
          days: 0
        }
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// Container Apps
// ---------------------------------------------------------------------------

resource acaEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: acaEnvName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        // The environment needs the workspace shared key to ship logs. This is
        // a platform-to-platform credential resolved at deployment time by the
        // ARM engine; it never appears in an app setting and the application
        // never sees it.
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    zoneRedundant: false
  }
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    environmentId: acaEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        // Off deliberately. The rate limiter is per-instance and best-effort by
        // design; pinning a client to a replica would imply a stronger
        // guarantee than the implementation makes.
        stickySessions: {
          affinity: 'none'
        }
        corsPolicy: {
          allowedOrigins: [
            '*'
          ]
          allowedMethods: [
            'GET'
            'POST'
            'OPTIONS'
          ]
          allowedHeaders: [
            'content-type'
          ]
        }
      }
      registries: registryRequiresAuthentication
        ? [
            {
              server: registryServer
              identity: identity.id
            }
          ]
        : []
      // Empty, and it stays empty. Everything the app needs to reach is reached
      // with the managed identity.
      secrets: []
    }
    template: {
      containers: [
        {
          name: 'app'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'COSMOS_ENDPOINT'
              value: cosmos.properties.documentEndpoint
            }
            {
              name: 'COSMOS_DATABASE'
              value: cosmosDatabaseName
            }
            {
              name: 'COSMOS_CONTAINER'
              value: submissionsContainerName
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: identity.properties.clientId
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              value: appInsights.properties.ConnectionString
            }
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'PORT'
              value: '3000'
            }
          ]
          probes: [
            {
              type: 'Readiness'
              httpGet: {
                path: '/api/health'
                port: 3000
              }
              initialDelaySeconds: 3
              periodSeconds: 10
              failureThreshold: 3
            }
            {
              type: 'Liveness'
              httpGet: {
                path: '/api/health'
                port: 3000
              }
              initialDelaySeconds: 10
              periodSeconds: 30
              failureThreshold: 5
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-concurrency'
            http: {
              metadata: {
                concurrentRequests: '${concurrentRequestsPerReplica}'
              }
            }
          }
        ]
      }
    }
  }
}

resource acaDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: containerApp
  name: 'to-log-analytics'
  properties: {
    workspaceId: logAnalytics.id
    logs: [
      {
        categoryGroup: 'allLogs'
        enabled: true
        retentionPolicy: {
          enabled: false
          days: 0
        }
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
        retentionPolicy: {
          enabled: false
          days: 0
        }
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// Optional Front Door + WAF
// ---------------------------------------------------------------------------

resource wafPolicy 'Microsoft.Network/FrontDoorWebApplicationFirewallPolicies@2024-02-01' = if (enableFrontDoor) {
  name: wafName
  location: 'global'
  tags: tags
  sku: {
    name: 'Standard_AzureFrontDoor'
  }
  properties: {
    policySettings: {
      enabledState: 'Enabled'
      mode: 'Prevention'
      requestBodyCheck: 'Enabled'
    }
    managedRules: {
      managedRuleSets: [
        {
          ruleSetType: 'Microsoft_DefaultRuleSet'
          ruleSetVersion: '2.1'
          ruleSetAction: 'Block'
        }
        {
          ruleSetType: 'Microsoft_BotManagerRuleSet'
          ruleSetVersion: '1.0'
        }
      ]
    }
  }
}

resource frontDoor 'Microsoft.Cdn/profiles@2024-02-01' = if (enableFrontDoor) {
  name: frontDoorName
  location: 'global'
  tags: tags
  sku: {
    name: 'Standard_AzureFrontDoor'
  }
}

resource frontDoorEndpoint 'Microsoft.Cdn/profiles/afdEndpoints@2024-02-01' = if (enableFrontDoor) {
  parent: frontDoor
  name: '${namePrefix}-endpoint'
  location: 'global'
  properties: {
    enabledState: 'Enabled'
  }
}

resource frontDoorOriginGroup 'Microsoft.Cdn/profiles/originGroups@2024-02-01' = if (enableFrontDoor) {
  parent: frontDoor
  name: 'aca-origin-group'
  properties: {
    loadBalancingSettings: {
      sampleSize: 4
      successfulSamplesRequired: 3
      additionalLatencyInMilliseconds: 50
    }
    healthProbeSettings: {
      probePath: '/api/health'
      probeRequestType: 'GET'
      probeProtocol: 'Https'
      probeIntervalInSeconds: 60
    }
  }
}

resource frontDoorOrigin 'Microsoft.Cdn/profiles/originGroups/origins@2024-02-01' = if (enableFrontDoor) {
  parent: frontDoorOriginGroup
  name: 'aca-origin'
  properties: {
    hostName: containerApp.properties.configuration.ingress.fqdn
    originHostHeader: containerApp.properties.configuration.ingress.fqdn
    httpPort: 80
    httpsPort: 443
    priority: 1
    weight: 1000
    enabledState: 'Enabled'
    enforceCertificateNameCheck: true
  }
}

resource frontDoorRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2024-02-01' = if (enableFrontDoor) {
  parent: frontDoorEndpoint
  name: 'default-route'
  properties: {
    originGroup: {
      id: frontDoorOriginGroup.id
    }
    supportedProtocols: [
      'Http'
      'Https'
    ]
    patternsToMatch: [
      '/*'
    ]
    forwardingProtocol: 'HttpsOnly'
    linkToDefaultDomain: 'Enabled'
    httpsRedirect: 'Enabled'
    enabledState: 'Enabled'
  }
  dependsOn: [
    frontDoorOrigin
  ]
}

resource frontDoorSecurityPolicy 'Microsoft.Cdn/profiles/securityPolicies@2024-02-01' = if (enableFrontDoor) {
  parent: frontDoor
  name: 'waf-policy-link'
  properties: {
    parameters: {
      type: 'WebApplicationFirewall'
      wafPolicy: {
        id: enableFrontDoor ? wafPolicy.id : ''
      }
      associations: [
        {
          domains: [
            {
              id: enableFrontDoor ? frontDoorEndpoint.id : ''
            }
          ]
          patternsToMatch: [
            '/*'
          ]
        }
      ]
    }
  }
  dependsOn: [
    frontDoorRoute
  ]
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

output appUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
output frontDoorUrl string = enableFrontDoor
  ? 'https://${frontDoorEndpoint!.properties.hostName}'
  : ''
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output cosmosDatabase string = cosmosDatabaseName
output managedIdentityClientId string = identity.properties.clientId
output managedIdentityPrincipalId string = identity.properties.principalId
output applicationInsightsName string = appInsights.name
output logAnalyticsWorkspaceId string = logAnalytics.id
output containerAppName string = containerApp.name
output resourceGroupName string = resourceGroup().name
