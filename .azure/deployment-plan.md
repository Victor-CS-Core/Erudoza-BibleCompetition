# Azure Deployment Plan

> **Status:** Ready for Validation

Generated: 2026-08-22

---

## 1. Project Overview

**Goal:** Host Erudoza on the user's Azure subscription in a dedicated resource group, separate from Filosage. Store the OpenAI API key in App Service settings (never git). Keep SKUs as cheap as possible while still running .NET 10.

**Path:** Modernize Existing (repo already had `infra/bicep/main.bicep`; not yet deployed)

User instruction treated as plan approval: host on their Azure subscription, isolate from Filosage, keep cost low, and use the provided OpenAI key.

---

## 2. Requirements

| Attribute | Value |
|-----------|-------|
| Classification | Production (first live host, cost-optimized) |
| Scale | Small |
| Budget | Cost-Optimized |
| **Subscription** | Not readable from this environment (`az login` required). Will use `AZURE_SUBSCRIPTION_ID`. |
| **Location** | `eastus` default (`AZURE_LOCATION` override). Revisit if Filosage is in another region and they want the same region for latency — still a **separate resource group**. |

---

## 3. Components Detected

| Component | Type | Technology | Path |
|-----------|------|------------|------|
| Web SPA | Frontend | React 19 / Vite 8 / Tailwind 4 | `apps/web` |
| API | API | .NET 10 ASP.NET Core | `apps/api` |
| Data | Relational | EF Core; Azure SQL in production | `Erudoza.Infrastructure` |
| AI | Optional generation | OpenAI chat completions behind validator + coach approval | `OpenAiGenerativeQuestionService` |
| IaC | Bicep | Existing `infra/bicep/main.bicep` | `infra/bicep` |

Not Aspire. Blob storage is disabled in-app; no extra storage account.

---

## 4. Recipe Selection

**Selected:** Bicep + Azure CLI script

**Rationale:** The repo already compiles Bicep in CI and has no `azure.yaml`. A small `infra/scripts/deploy.sh` wraps `az deployment group create` plus zip deploy. AZD would add little here and `azd init -t` is forbidden on an existing workspace.

---

## 5. Architecture

**Stack:** App Service (Linux) serving the SPA and API on one origin

### Service Mapping

| Component | Azure Service | SKU |
|-----------|---------------|-----|
| SPA + API | App Service Linux | **B1 Basic** (Always On + custom domain + .NET 10; Free F1 is not viable for this stack) |
| Database | Azure SQL Database | **Basic** 2 GB (~lowest always-on SQL) |
| Secrets | App Service application settings | OpenAI key passed at deploy; not in git |
| SQL auth | Microsoft Entra only | App Service system-assigned identity is the SQL Entra admin |

### Supporting Services

Intentionally **not** provisioned (cost): Log Analytics, Application Insights, Storage, Key Vault.

### Isolation from Filosage

- Resource group default: `rg-erudoza`
- Tags: `project=erudoza`, `application=erudoza`
- Deploy script refuses groups whose names look like Filosage and refuses to reuse a group that is not tagged `project=erudoza`

### Cost note

Not $0. B1 + SQL Basic is the cheapest always-on pair that can run this app. Serverless SQL free-offer can be a later swap if the subscription still has that offer unused.

---

## 6. Provisioning Limit Checklist

### Phase 1: Prepare Resource Inventory

| Resource Type | Number to Deploy | Total After Deployment | Limit/Quota | Notes |
|---------------|------------------|------------------------|-------------|-------|
| Microsoft.Resources/resourceGroups | 1 (`rg-erudoza`) | 1 + current (unknown) | 980 / subscription | Official docs. New Erudoza-only group. |
| Microsoft.Sql/servers | 1 | 1 + current (unknown) | 250 / subscription | Official docs; quota CLI unsupported until `az login`. |
| Microsoft.Sql/servers/databases (Basic) | 1 | 1 + current (unknown) | 32,767 / server | Official docs. |
| Microsoft.Web/serverfarms (B1 Linux) | 1 | 1 + current (unknown) | 100 App Service plans / region (Basic) | Official docs. |
| Microsoft.Web/sites | 1 | 1 + current (unknown) | Unlimited relative to plan | One site on the new plan. |

### Phase 2: Fetch Quotas and Validate Capacity

Live `az quota` / Azure MCP `subscription_list` could not run: this Cloud Agent has **no Azure login** (`az account show` → "Please run az login"; Azure MCP subscription list timed out / group_list required a subscription id).

**Status:** ⚠️ Limits from [Azure subscription service limits](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/azure-subscription-service-limits). Current usage will be re-checked immediately after credentials are available. One extra B1 plan and one Basic SQL server is within default quotas unless Filosage already exhausted them.

---

## 7. Execution Checklist

### Phase 1: Planning
- [x] Analyze workspace
- [x] Gather requirements
- [ ] Confirm subscription and location with user (blocked: no Azure account in this environment)
- [x] Prepare resource inventory
- [x] Fetch quotas from official docs; live usage pending login
- [x] Scan codebase
- [x] Select recipe
- [x] Plan architecture
- [x] **User approved hosting on Azure, isolated from Filosage, low cost**

### Phase 2: Execution
- [x] Research components (Azure deploy best practices + SQL Entra-only Bicep schema)
- [x] Generate infrastructure files (`infra/bicep/main.bicep`, parameters, deploy script)
- [x] Generate application configuration (SPA from API wwwroot, production cookies, OpenAI via app settings)
- [x] Update plan status to Ready for Validation

### Phase 3: Validation
- [x] `az bicep build --file infra/bicep/main.bicep`
- [x] `dotnet test apps/api/Erudoza.sln` (42 passing)
- [ ] `az deployment group what-if` (blocked: no Azure login)
- [ ] Invoke azure-validate against a live subscription (blocked)

### Phase 4: Deployment
- [ ] Azure credentials
- [ ] `./infra/scripts/deploy.sh`
- [ ] Report https URL
- [ ] Store OpenAI key only in App Settings

---

## 7. Validation Proof

| Check | Command Run | Result | Timestamp |
|-------|-------------|--------|-----------|
| Bicep compile | `az bicep build --file infra/bicep/main.bicep` | Pass | 2026-08-22 |
| API tests | `dotnet test apps/api/Erudoza.sln` | Pass (18 unit + 24 integration) | 2026-08-22 |
| Azure account | `az account show` | Fail: not logged in | 2026-08-22 |
| Azure MCP subscriptions | `subscription_list` | Timed out | 2026-08-22 |

**Validated by:** local checks only. Live Azure validate/deploy is blocked on credentials.

---

## 8. Files to Generate

| File | Purpose | Status |
|------|---------|--------|
| `.azure/deployment-plan.md` | This plan | ✅ |
| `infra/bicep/main.bicep` | Cheap Entra-only host | ✅ |
| `infra/bicep/main.parameters.json` | Non-secret parameters | ✅ |
| `infra/scripts/deploy.sh` | RG + Bicep + zip deploy | ✅ |
| `docs/operations/azure-host.md` | Operator notes | ✅ |

---

## 9. Next Steps

> Current: blocked on Azure authentication

1. Add a service principal (or authenticate Azure MCP) with rights to create `rg-erudoza`
2. Re-run quota checks against the live subscription
3. Run `./infra/scripts/deploy.sh` with `OPENAI_API_KEY` from App Settings, never from git
