#!/usr/bin/env bash
set -euo pipefail

# Deploys Erudoza into its own Azure resource group. Never targets Filosage groups.
# Required once authenticated:
#   AZURE_SUBSCRIPTION_ID
# Optional:
#   AZURE_LOCATION (default eastus)
#   ERUDOZA_RESOURCE_GROUP (default rg-erudoza)
#   OPENAI_API_KEY (enables generation jobs behind coach approval)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RG="${ERUDOZA_RESOURCE_GROUP:-rg-erudoza}"
LOCATION="${AZURE_LOCATION:-eastus}"
SUBSCRIPTION="${AZURE_SUBSCRIPTION_ID:?Set AZURE_SUBSCRIPTION_ID}"
OPENAI_KEY="${OPENAI_API_KEY:-}"

if [[ "$RG" =~ [Ff]ilo|[Ss]age ]]; then
  echo "Refusing to deploy Erudoza into a Filosage-looking resource group: $RG" >&2
  exit 1
fi

if [[ -n "${AZURE_CLIENT_ID:-}" && -n "${AZURE_CLIENT_SECRET:-}" && -n "${AZURE_TENANT_ID:-}" ]]; then
  az login --service-principal \
    --username "$AZURE_CLIENT_ID" \
    --password "$AZURE_CLIENT_SECRET" \
    --tenant "$AZURE_TENANT_ID" \
    --output none
fi

az account set --subscription "$SUBSCRIPTION"

existing_name="$(az group show --name "$RG" --query name -o tsv 2>/dev/null || true)"
if [[ -n "$existing_name" ]]; then
  existing_tags="$(az group show --name "$RG" --query "tags.project" -o tsv 2>/dev/null || true)"
  if [[ "$existing_tags" != "erudoza" ]]; then
    echo "Resource group $RG exists without project=erudoza. Refusing to reuse it." >&2
    exit 1
  fi
else
  az group create --name "$RG" --location "$LOCATION" --tags project=erudoza application=erudoza --output none
fi

export PATH="${HOME}/.dotnet:${PATH:-}"
export DOTNET_ROOT="${HOME}/.dotnet"

cd "$ROOT"
npm ci
npm run build:web
rm -rf apps/api/src/Erudoza.Api/wwwroot
mkdir -p apps/api/src/Erudoza.Api/wwwroot
cp -R apps/web/dist/. apps/api/src/Erudoza.Api/wwwroot/

PUBLISH_DIR="$(mktemp -d)"
dotnet publish apps/api/src/Erudoza.Api/Erudoza.Api.csproj -c Release -o "$PUBLISH_DIR"

DEPLOY_PARAMS=(
  --resource-group "$RG"
  --template-file infra/bicep/main.bicep
  --parameters namePrefix=erudz projectTag=erudoza
)
if [[ -n "$OPENAI_KEY" ]]; then
  DEPLOY_PARAMS+=(--parameters openAiApiKey="$OPENAI_KEY")
fi

az deployment group create --name erudoza-host "${DEPLOY_PARAMS[@]}"

API_SITE="$(az deployment group show --resource-group "$RG" --name erudoza-host --query properties.outputs.apiSiteName.value -o tsv)"
API_URL="$(az deployment group show --resource-group "$RG" --name erudoza-host --query properties.outputs.apiUrl.value -o tsv)"
ZIP="$(mktemp /tmp/erudoza-publish.XXXXXX.zip)"
python3 - <<PY
import pathlib, zipfile
root = pathlib.Path("$PUBLISH_DIR")
with zipfile.ZipFile("$ZIP", "w", zipfile.ZIP_DEFLATED) as archive:
    for path in root.rglob("*"):
        if path.is_file():
            archive.write(path, path.relative_to(root).as_posix())
PY

az webapp deploy --resource-group "$RG" --name "$API_SITE" --src-path "$ZIP" --type zip --async false

echo "Deployed Erudoza to ${API_URL}"
