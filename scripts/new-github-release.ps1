<#
.SYNOPSIS
    Creates a GitHub release for this repository using the GitHub CLI (gh).

.DESCRIPTION
    Uses `gh release create` with release notes, draft/prerelease flags, and asset uploads.
    If you do not pass -Notes or -NotesFile, the script runs `scripts/generate-release-notes.js`
    and attaches release-notes/latest.md (git log since the latest tag). Use -GitHubGenerateNotes
    to use GitHub's --generate-notes instead.

    Tags use the form v[major].[minor].[patch] (same as package.json semver with a leading v).
    If -Tag is omitted, the default tag is v<version> from package.json after an optional semver bump.
    By default the script bumps the patch version in package.json before building (npm version patch
    equivalent). Use -BumpMinor or -BumpMajor for those increments instead. Use -SkipVersionBump to
    keep the current package.json version and tag v<that version>.

    If you pass -Tag explicitly, no semver bump is applied (you align package.json and the tag yourself).

    By default runs `npm run dist` to produce the NSIS installer, then uploads it from dist.
    Use -SkipDist if you already built into dist. Use -SkipArtifact to skip the installer and dist step.

.PARAMETER Tag
    Git tag for the release (e.g. v1.2.3). When set, no automatic semver bump is performed.

.PARAMETER Title
    Release title. Default: "Froggy Flash <Tag>".

.PARAMETER Notes
    Release notes body (plain text or markdown). Overrides -NotesFile and skips the local release-notes generator.

.PARAMETER NotesFile
    Path to a file whose contents become the release notes. Ignored if -Notes is set.

.PARAMETER GitHubGenerateNotes
    When set (and -Notes / -NotesFile are not), pass gh --generate-notes instead of running
    scripts/generate-release-notes.js.

.PARAMETER BumpMinor
    When -Tag is omitted and -SkipVersionBump is not set, bump the minor version instead of patch.

.PARAMETER BumpMajor
    When -Tag is omitted and -SkipVersionBump is not set, bump the major version instead of patch.

.PARAMETER Draft
    Create a draft release.

.PARAMETER Prerelease
    Mark as prerelease.

.PARAMETER Assets
    Paths to files to attach (e.g. dist\installer.exe).

.PARAMETER TargetBranch
    Branch (or commit) the new tag points at when the tag does not exist yet. Default: main.

.PARAMETER SkipVersionBump
    When -Tag is omitted, do not run scripts/bump-version.js; tag becomes v<current package.json version>.

.PARAMETER SkipDist
    Do not run `npm run dist` before publishing. Use when the installer for the current version is already in dist/.
    Ignored when -SkipArtifact is set.

.PARAMETER SkipArtifact
    Create a release without attaching the NSIS installer (also skips the dist step).

.EXAMPLE
    .\scripts\new-github-release.ps1
    Bumps patch in package.json, runs npm run dist, generates notes, creates tag v1.0.1, uploads installer.

.EXAMPLE
    npm run release
    Same as the example above (npm script runs this script).

.EXAMPLE
    .\scripts\new-github-release.ps1 -BumpMinor
    Bumps minor version, then same as default release flow.

.EXAMPLE
    .\scripts\new-github-release.ps1 -Tag v2.0.0 -SkipDist
    Creates release v2.0.0 using an existing dist installer (no semver bump; ensure package.json matches).

.EXAMPLE
    .\scripts\new-github-release.ps1 -SkipVersionBump -SkipDist
    Tags v<current version> without bumping package.json (for republishing or drafts).

.EXAMPLE
    .\scripts\new-github-release.ps1 -GitHubGenerateNotes
    Default bump and dist, but uses GitHub's auto-generated release notes instead of release-notes/latest.md.

.NOTES
    Prerequisites:
      - GitHub CLI: https://cli.github.com/  (install then run: gh auth login)
      - Node.js and npm on PATH (for `npm run dist` unless -SkipDist or -SkipArtifact)
      - Commit package.json after a release when you used the default version bump.
      - Run from repo root or any path; the script locates the project root via this file's location.
#>

[CmdletBinding()]
param(
    [string] $Tag,

    [string] $Title,

    [string] $Notes,

    [string] $NotesFile,

    [switch] $GitHubGenerateNotes,

    [switch] $BumpMinor,

    [switch] $BumpMajor,

    [switch] $Draft,

    [switch] $Prerelease,

    [string[]] $Assets = @(),

    [string] $TargetBranch = 'main',

    [switch] $SkipVersionBump,

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

if ($BumpMajor -and $BumpMinor) {
    Write-Error 'Use at most one of -BumpMajor or -BumpMinor. With neither, the default bump is patch.'
}

if (-not $Tag) {
    if (-not $SkipVersionBump) {
        $bumpKind = if ($BumpMajor) { 'major' } elseif ($BumpMinor) { 'minor' } else { 'patch' }
        Write-Host "Bumping package.json version ($bumpKind, --no-git-tag-version)..." -ForegroundColor Cyan
        & node (Join-Path $repoRoot 'scripts\bump-version.js') $bumpKind
        if ($LASTEXITCODE -ne 0) {
            Write-Error "bump-version.js $bumpKind failed with exit code $LASTEXITCODE"
        }
        $pkg = Get-Content -LiteralPath $pkgPath -Raw | ConvertFrom-Json
        if (-not $pkg.version) {
            Write-Error 'package.json has no "version" field after bump.'
        }
    }
    $Tag = 'v{0}' -f $pkg.version.Trim()
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

Write-Host 'Done. If package.json was bumped, commit the version change when you are ready.' -ForegroundColor Green
