#!/bin/bash

set -e

# 1. 更新版本号（例如更新 patch 版本）
npm version patch

echo "🔨 开始构建..."
npm run build

echo "📦 准备发布..."
VERSION=$(node -p "require('./package.json').version")
PACKAGE_NAME=$(node -p "require('./package.json').name")

echo "📊 项目信息:"
echo "   包名: $PACKAGE_NAME"
echo "   版本: $VERSION"
echo ""

echo "🚀 将更新和标签推送到远程仓库 ..."

echo "git push && git push --tags"

