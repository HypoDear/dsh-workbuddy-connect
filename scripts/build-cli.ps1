# 构建 lib/bin.js —— 必须先把宿主 @deepseek-ai/* 临时链接进来
#
# 为什么需要这一步：
#   插件按 `pnpm install --prod` 安装，`@deepseek-ai/*`（peerDependency）不在
#   本目录 node_modules 里 —— 这是刻意的，避免运行时遮蔽宿主同名包。
#   但 tsdown 的 `alwaysBundle` 只内联**能解析到**的包：解析不到就静默保留
#   `import ... from "@deepseek-ai/..."`，构建看起来成功，产物却在启动时
#   ERR_MODULE_NOT_FOUND。
#
# 实测（2026-10-17）：
#   无链接 -> lib/bin.js 184,290 bytes，import 保持外部，doctor 命令崩溃
#   有链接 -> lib/bin.js 194,648 bytes，withFileLock 被内联，doctor 正常
#
# 本脚本建一个临时 junction -> 构建 -> 立即移除，不改变 --prod 的安装状态。
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $PSScriptRoot   # 仓库根（本脚本在 scripts/ 下）
$hostNM = Join-Path $env:APPDATA 'npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai'
$link = Join-Path $here 'node_modules\@deepseek-ai'

if (-not (Test-Path $hostNM)) {
    Write-Error "找不到宿主的 @deepseek-ai 目录：$hostNM"
    exit 1
}

$created = $false
try {
    if (Test-Path $link) {
        Write-Host "已存在 node_modules/@deepseek-ai，直接构建（可能是完整安装）"
    } else {
        New-Item -ItemType Junction -Path $link -Target $hostNM -Force | Out-Null
        $created = $true
        Write-Host "已临时链接宿主 @deepseek-ai -> node_modules/@deepseek-ai"
    }

    Push-Location $here
    try {
        # tsdown 是 devDependency，`pnpm install --prod` 后不在 node_modules/.bin，
        # 所以不能靠 npx。按 glob 直接找它的 dist/run.mjs（版本号会变，不写死）。
        $pnpmDir = Join-Path $here 'node_modules\.pnpm'
        $run = @(Get-ChildItem -Path $pnpmDir -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.PSIsContainer -and $_.Name -like 'tsdown@*' } |
            ForEach-Object { Join-Path $_.FullName 'node_modules\tsdown\dist\run.mjs' } |
            Where-Object { Test-Path $_ }) | Select-Object -First 1

        if (-not $run) {
            throw "找不到 tsdown（$pnpmDir 下无 tsdown@*/node_modules/tsdown/dist/run.mjs）。请先 pnpm install 装上 devDependencies。"
        }
        Write-Host "使用 tsdown: $run"

        & node $run
        if ($LASTEXITCODE -ne 0) { throw "tsdown 退出码 $LASTEXITCODE" }
    } finally { Pop-Location }

    # 校验：bin.js 必须真的内联了
    $bin = Join-Path $here 'lib\bin.js'
    $src = Get-Content $bin -Raw
    $stillExternal = $src -match 'from "@deepseek-ai/'
    $inlined = $src -match 'function withFileLock'

    Write-Host ''
    Write-Host "lib/bin.js  $((Get-Item $bin).Length) bytes"
    Write-Host "  外部 @deepseek-ai import : $stillExternal"
    Write-Host "  内联 withFileLock 实现   : $inlined"

    if ($stillExternal -or -not $inlined) {
        Write-Error '构建产物仍是外部 import —— alwaysBundle 未生效，CLI 会 ERR_MODULE_NOT_FOUND'
        exit 1
    }
    Write-Host 'bin.js 内联校验通过' -ForegroundColor Green
}
finally {
    if ($created -and (Test-Path $link)) {
        [System.IO.Directory]::Delete($link)
        Write-Host '已移除临时链接'
    }
}
