<#
.SYNOPSIS
    Creates a GitHub release for this repository using the GitHub CLI (gh).

.DESCRIPTION
    Uses `gh release create` with optional auto-generated notes, draft/prerelease flags,
    and asset uploads. If -Tag is omitted, the tag is "v<version>-b<build>" from package.json and
    build-info.json (unique per build; same semver can ship multiple times).
    After a successful release, increments build-info.json (build number) unless -SkipBuildBump is set.
    By default uploads the NSIS installer from dist (same name as electron-builder.config.cjs);
    run `npm run dist` first. Use -SkipArtifact to create a release without an installer file.

.PARAMETER Tag
    Git tag for the release. Default: v<version>-b<build> (e.g. v1.0.0-b5). Override for a custom tag.

.PARAMETER Title
    Release title. Default: "Froggy Flash <Tag>".

.PARAMETER Notes
    Release notes body (plain text or markdown). Overrides -NotesFile and disables default auto-generated notes.

.PARAMETER NotesFile
    Path to a file whose contents become the release notes. Ignored if -Notes is set.

.PARAMETER NoGenerateNotes
    When set, do not pass --generate-notes (only use with -Notes or -NotesFile, or gh may prompt).

.PARAMETER Draft
    Create a draft release.

.PARAMETER Prerelease
    Mark as prerelease.

.PARAMETER Assets
    Paths to files to attach (e.g. dist\installer.exe).

.PARAMETER TargetBranch
    Branch (or commit) the new tag points at when the tag does not exist yet. Default: main.

.PARAMETER SkipBuildBump
    Do not increment build-info.json after a successful release (default is to bump once per release).

.EXAMPLE
    .\scripts\new-github-release.ps1
    Creates release v1.0.0-b<N> using the current build number from build-info.json.

.EXAMPLE
    .\scripts\new-github-release.ps1 -Tag v1.1.0 -Notes "Bug fixes and UI tweaks." -Draft

.EXAMPLE
    .\scripts\new-github-release.ps1 -Assets "dist\Froggy Flash Setup 1.0.0.exe"

.NOTES
    Prerequisites:
      - GitHub CLI: https://cli.github.com/  (install then run: gh auth login)
      - Run from repo root or any path; the script locates the project root via this file's location.
#>

[CmdletBinding()]
param(
    [string] $Tag,

    [string] $Title,

    [string] $Notes,

    [string] $NotesFile,

    [switch] $NoGenerateNotes,

    [switch] $Draft,

    [switch] $Prerelease,

    [string[]] $Assets = @(),

    [string] $TargetBranch = 'main',

    [switch] $SkipBuildBump,

    [switch] $SkipArtifact
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot = Split-Path -Parent $scriptDir
Set-Location $repoRoot

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Error 'GitHub CLI (gh) is not installed or not on PATH. Install from https://cli.github.com/ and run: gh auth login'
}

$pkgPath = Join-Path $repoRoot 'package.json'
if (-not (Test-Path -LiteralPath $pkgPath)) {
    Write-Error "package.json not found at: $pkgPath"
}

$pkg = Get-Content -LiteralPath $pkgPath -Raw | ConvertFrom-Json
if (-not $pkg.version) {
    Write-Error 'package.json has no "version" field.'
}

if (-not $Tag) {
    $buildInfoPath = Join-Path $repoRoot 'build-info.json'
    if (-not (Test-Path -LiteralPath $buildInfoPath)) {
        Write-Error "build-info.json not found at: $buildInfoPath (required for default tag v<version>-b<build>)."
    }
    $buildInfo = Get-Content -LiteralPath $buildInfoPath -Raw | ConvertFrom-Json
    if ($null -eq $buildInfo.build) {
        Write-Error 'build-info.json must contain a numeric "build" field.'
    }
    try {
        $buildNum = [int]$buildInfo.build
    }
    catch {
        Write-Error 'build-info.json "build" must be an integer.'
    }
    if ($buildNum -lt 0) {
        Write-Error 'build-info.json "build" must be >= 0.'
    }
    $Tag = 'v{0}-b{1}' -f $pkg.version.Trim(), $buildNum
}

if (-not $Title) {
    $Title = 'Froggy Flash {0}' -f $Tag
}

$ghArgs = @(
    'release', 'create', $Tag,
    '--title', $Title,
    '--target', $TargetBranch
)

if ($Draft) { $ghArgs += '--draft' }
if ($Prerelease) { $ghArgs += '--prerelease' }

if ($Notes) {
    $ghArgs += '--notes', $Notes
}
elseif ($NotesFile) {
    $resolvedNotes = Resolve-Path -LiteralPath $NotesFile -ErrorAction Stop
    $ghArgs += '--notes-file', $resolvedNotes.Path
}
elseif (-not $NoGenerateNotes) {
    $ghArgs += '--generate-notes'
}

foreach ($a in $Assets) {
    if (-not (Test-Path -LiteralPath $a)) {
        Write-Error "Asset not found: $a"
    }
    $ghArgs += (Resolve-Path -LiteralPath $a).Path
}

if (-not $SkipArtifact) {
    $resolver = Join-Path $repoRoot 'scripts\resolve-release-artifact.js'
    $artifactPath = (& node $resolver)
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
    if ([string]::IsNullOrWhiteSpace($artifactPath)) {
        Write-Error 'resolve-release-artifact.js returned an empty path.'
    }
    $artifactPath = $artifactPath.Trim()
    Write-Host "Attaching installer: $artifactPath" -ForegroundColor Cyan
    $ghArgs += $artifactPath
}

Write-Host "Creating GitHub release: $Tag" -ForegroundColor Cyan
Write-Host "Title: $Title" -ForegroundColor Gray
Write-Host "gh $($ghArgs -join ' ')" -ForegroundColor DarkGray

& gh @ghArgs
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

if (-not $SkipBuildBump) {
    Write-Host 'Incrementing build number for the next release...' -ForegroundColor Cyan
    & node (Join-Path $repoRoot 'scripts\bump-build.js')
}

Write-Host 'Done.' -ForegroundColor Green
