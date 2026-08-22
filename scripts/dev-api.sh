#!/usr/bin/env bash
set -euo pipefail
export PATH="${HOME}/.dotnet:${PATH}"
export DOTNET_ROOT="${HOME}/.dotnet"
export ASPNETCORE_ENVIRONMENT="${ASPNETCORE_ENVIRONMENT:-Development}"
export Database__Provider="${Database__Provider:-Sqlite}"
export Database__ConnectionString="${Database__ConnectionString:-Data Source=erudoza.dev.db}"
dotnet run --project "$(dirname "$0")/../apps/api/src/Erudoza.Api/Erudoza.Api.csproj" --urls http://localhost:5080
