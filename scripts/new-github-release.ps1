<#
.SYNOPSIS
    Creates a GitHub release for this repository using the GitHub CLI (gh).

.DESCRIPTION
    Uses `gh release create` with release notes, draft/prerelease flags, and asset uploads.
    If you do not pass -Notes or -NotesFile, the script runs `scripts/generate-release-notes.js`
    and attaches release-notes/latest.md (git log since the latest tag). Use -GitHubGenerateNotes
    to use GitHub's --generate-notes instead. If -Tag is omitted, the tag is "v<version>-b<build>"
    from package.json and build-info.json (unique per build; same semver can ship multiple times).
    After a successful release, increments build-info.json (build number) unless -SkipBuildBump is set.
    By default runs `npm run dist` to produce the NSIS installer, then uploads it from dist
    (same name as electron-builder.config.cjs). Use -SkipDist if you already built into dist.
    Use -SkipArtifact to create a release without an installer file (also skips the dist step).

.PARAMETER Tag
    Git tag for the release. Default: v<version>-b<build> (e.g. v1.0.0-b5). Override for a custom tag.

.PARAMETER Title
    Release title. Default: "Froggy Flash <Tag>".

.PARAMETER Notes
    Release notes body (plain text or markdown). Overrides -NotesFile and skips the local release-notes generator.

.PARAMETER NotesFile
    Path to a file whose contents become the release notes. Ignored if -Notes is set.

.PARAMETER GitHubGenerateNotes
    When set (and -Notes / -NotesFile are not), pass gh --generate-notes instead of running
    scripts/generate-release-notes.js.

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

.PARAMETER SkipDist
    Do not run `npm run dist` before publishing. Use when the installer for the current build
    number is already in dist/. Ignored when -SkipArtifact is set.

.EXAMPLE
    .\scripts\new-github-release.ps1
    Runs npm run dist, generates release notes, creates release v1.0.0-b<N> from build-info.json,
    uploads the NSIS installer, then bumps the build number.

.EXAMPLE
    npm run release
    Same as the example above (npm script runs this script).

.EXAMPLE
    .\scripts\new-github-release.ps1 -Tag v1.1.0 -Notes "Bug fixes and UI tweaks." -Draft

.EXAMPLE
    .\scripts\new-github-release.ps1 -Assets "dist\Froggy Flash Setup 1.0.0.exe"

.EXAMPLE
    .\scripts\new-github-release.ps1 -GitHubGenerateNotes
    Same as default release flow but uses GitHub's auto-generated release notes instead of release-notes/latest.md.

.EXAMPLE
    .\scripts\new-github-release.ps1 -SkipDist
    Publishes using an installer already produced in dist/ (skips npm run dist).

.NOTES
    Prerequisites:
      - GitHub CLI: https://cli.github.com/  (install then run: gh auth login)
      - Node.js and npm on PATH (for `npm run dist` unless -SkipDist or -SkipArtifact)
      - Run from repo root or any path; the script locates the project root via this file's location.
#>

[CmdletBinding()]
param(
    [string] $Tag,

    [string] $Title,

    [string] $Notes,

    [string] $NotesFile,

    [switch] $GitHubGenerateNotes,

    [switch] $Draft,

    [switch] $Prerelease,

    [string[]] $Assets = @(),

    [string] $TargetBranch = 'main',

    [switch] $SkipBuildBump,

    [switch] $SkipArtifact,

    [switch] $SkipDist
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

if (-not $SkipArtifact -and -not $SkipDist) {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Error 'npm is not on PATH (needed for npm run dist). Install Node.js or use -SkipDist if the installer is already in dist/.'
    }
    Write-Host 'Building Windows installer (npm run dist)...' -ForegroundColor Cyan
    & npm run dist
    if ($LASTEXITCODE -ne 0) {
        Write-Error "npm run dist failed with exit code $LASTEXITCODE"
    }
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
elseif ($GitHubGenerateNotes) {
    $ghArgs += '--generate-notes'
}
else {
    $genScript = Join-Path $repoRoot 'scripts\generate-release-notes.js'
    $notesOut = Join-Path $repoRoot 'release-notes\latest.md'
    Write-Host 'Generating release notes (git log to release-notes\latest.md)...' -ForegroundColor Cyan
    & node $genScript --out $notesOut
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
    if (-not (Test-Path -LiteralPath $notesOut)) {
        Write-Error "Release notes were not written: $notesOut"
    }
    $resolvedNotes = Resolve-Path -LiteralPath $notesOut
    $ghArgs += '--notes-file', $resolvedNotes.Path
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
