param([string]$Out = 'D:\Github\Tavora\apps\desktop\resources\game-icons')
$ErrorActionPreference = 'Stop'
$ci = [Globalization.CultureInfo]::InvariantCulture
function N($v) { ([double]$v).ToString('0.##', $ci) }

function Gear($cx, $cy, $r, $teeth, $fill, $hole, $holeR) {
  $s = "<circle cx='$cx' cy='$cy' r='$r' fill='$fill'/>"
  for ($i = 0; $i -lt $teeth; $i++) {
    $a = N (360 / $teeth * $i)
    $s += "<rect x='$($cx - 14)' y='$($cy - $r - 30)' width='28' height='40' rx='5' fill='$fill' transform='rotate($a $cx $cy)'/>"
  }
  $s + "<circle cx='$cx' cy='$cy' r='$holeR' fill='$hole'/>"
}
function Pent($cx, $cy, $r, $fill, $rot) {
  $p = (0..4 | ForEach-Object { $a = ($rot + 72 * $_ - 90) * [math]::PI / 180; "$(N ($cx + $r * [math]::Cos($a))),$(N ($cy + $r * [math]::Sin($a)))" }) -join ' '
  "<polygon points='$p' fill='$fill'/>"
}
function Pickaxe($head, $handle) {
  "<rect x='119' y='84' width='18' height='140' rx='8' fill='$handle' transform='rotate(35 128 128)'/>" +
  "<path d='M52 112 Q128 40 204 112 Q128 80 52 112Z' fill='$head' transform='rotate(35 128 128)'/>"
}

$ivory = '#efe6d2'; $gold = '#d9a441'; $dgold = '#a9782c'

# id -> @(tavora background, tavora body, classic background, classic body)
$icons = [ordered]@{
  'minecraft' = @('#6b4f2a',
    "<polygon points='128,48 208,92 128,136 48,92' fill='$ivory'/><polygon points='48,92 128,136 128,224 48,180' fill='$gold'/><polygon points='208,92 128,136 128,224 208,180' fill='$dgold'/>",
    '#6fb3e0',
    "<polygon points='128,48 208,92 128,136 48,92' fill='#62b13b'/><polygon points='48,92 128,136 128,224 48,180' fill='#8b5a2b'/><polygon points='208,92 128,136 128,224 208,180' fill='#6f4520'/><polygon points='48,92 128,136 128,150 48,106' fill='#4f8f2e'/><polygon points='128,136 208,92 208,106 128,150' fill='#3f7a24'/>")
  'factorio' = @('#3f4a3a',
    (Gear 128 128 58 8 $ivory '#3f4a3a' 24),
    '#3a3a3a',
    ((Gear 128 128 58 8 '#f0a030' '#3a3a3a' 24) + "<rect x='0' y='212' width='256' height='20' fill='#f0a030' opacity='.35'/>"))
  'valheim' = @('#37504f',
    "<path d='M36 160 H220 Q200 212 128 212 Q56 212 36 160Z' fill='$gold'/><rect x='124' y='44' width='8' height='120' fill='$ivory'/><path d='M138 52 V150 H210Z' fill='$ivory'/><path d='M118 76 V150 H70Z' fill='$ivory' opacity='.7'/>",
    '#1f3a4a',
    "<path d='M36 160 H220 Q200 212 128 212 Q56 212 36 160Z' fill='#8b5a2b'/><rect x='124' y='44' width='8' height='120' fill='#5a3a1c'/><path d='M138 52 V150 H210Z' fill='#c9482f'/><path d='M118 76 V150 H70Z' fill='#e8dcc0'/><circle cx='200' cy='56' r='7' fill='#e8dcc0'/><circle cx='60' cy='48' r='4' fill='#e8dcc0'/>")
  'elden-ring' = @('#5a3d36',
    "<path d='M128 52 A76 76 0 1 1 52 128' fill='none' stroke='$gold' stroke-width='16' stroke-linecap='round'/><circle cx='128' cy='128' r='14' fill='$ivory'/>",
    '#0e0e12',
    "<path d='M128 44 A84 84 0 1 1 44 128' fill='none' stroke='#e2b659' stroke-width='10' stroke-linecap='round'/><path d='M128 68 A60 60 0 1 1 68 128' fill='none' stroke='#e2b659' stroke-width='5' stroke-linecap='round' opacity='.7'/><rect x='125' y='84' width='6' height='100' rx='3' fill='#e2b659' opacity='.85'/>")
  'hollow-knight' = @('#3b4656',
    "<circle cx='128' cy='128' r='78' fill='none' stroke='$ivory' stroke-width='6' opacity='.5'/><path d='M128 40 L146 150 L128 168 L110 150Z' fill='$ivory'/><rect x='96' y='168' width='64' height='10' rx='5' fill='$gold'/><rect x='122' y='178' width='12' height='38' rx='5' fill='$gold'/>",
    '#0c1018',
    "<circle cx='128' cy='128' r='84' fill='#9ec5ff' opacity='.16'/><circle cx='128' cy='128' r='56' fill='#9ec5ff' opacity='.2'/><path d='M128 40 L146 150 L128 168 L110 150Z' fill='#f2f2f2'/><rect x='96' y='168' width='64' height='10' rx='5' fill='#c8d6ea'/><rect x='122' y='178' width='12' height='38' rx='5' fill='#c8d6ea'/>")
  'stardew-valley' = @('#3f4a3a',
    "<rect x='60' y='186' width='136' height='22' rx='11' fill='$dgold'/><rect x='122' y='110' width='12' height='84' rx='6' fill='$ivory'/><path d='M128 126 Q70 124 66 70 Q124 70 128 126Z' fill='$ivory'/><path d='M128 112 Q186 108 192 54 Q132 56 128 112Z' fill='$gold'/>",
    '#7ec8e8',
    "<circle cx='196' cy='62' r='26' fill='#ffd84a'/><path d='M0 196 Q128 160 256 196 V256 H0Z' fill='#6aa84f'/><rect x='122' y='116' width='12' height='84' rx='6' fill='#3d7a2a'/><path d='M128 132 Q70 130 66 76 Q124 76 128 132Z' fill='#4caf50'/><path d='M128 118 Q186 114 192 60 Q132 62 128 118Z' fill='#7bd05a'/><ellipse cx='128' cy='204' rx='42' ry='10' fill='#6f4520'/>")
  'rocket-league' = @('#3b4656',
    ("<circle cx='140' cy='120' r='62' fill='$ivory'/>" + (Pent 140 120 24 '#3b4656' 0) + "<rect x='34' y='108' width='46' height='8' rx='4' fill='$gold'/><rect x='20' y='128' width='62' height='8' rx='4' fill='$gold' opacity='.7'/><rect x='44' y='148' width='30' height='8' rx='4' fill='$gold' opacity='.45'/>"),
    '#1b5fd1',
    ("<polygon points='0,256 256,0 256,256' fill='#f08a1c'/><circle cx='128' cy='128' r='64' fill='#f4f4f4'/>" + (Pent 128 128 26 '#222a36' 0) + "<path d='M20 200 L96 168' stroke='#fff' stroke-width='8' stroke-linecap='round' opacity='.7'/><path d='M40 224 L108 192' stroke='#fff' stroke-width='6' stroke-linecap='round' opacity='.45'/>"))
  'skyrim' = @('#3b4656',
    "<circle cx='186' cy='72' r='20' fill='$ivory'/><path d='M20 204 L104 80 L144 140 L172 104 L236 204Z' fill='$ivory'/><path d='M104 80 L128 116 L110 112 L98 126 L86 108Z' fill='$gold'/>",
    '#7da2c4',
    "<circle cx='190' cy='68' r='18' fill='#f4f1e6'/><path d='M0 212 L96 70 L142 138 L174 98 L256 212Z' fill='#4f5f70'/><path d='M96 70 L122 110 L104 106 L94 122 L80 100Z' fill='#f4f7fa'/><path d='M174 98 L192 124 L176 120 L166 130Z' fill='#f4f7fa'/><rect x='0' y='212' width='256' height='44' fill='#2f3a46'/>")
  'satisfactory' = @('#64422a',
    "<polygon points='128,44 202,86 202,170 128,212 54,170 54,86' fill='none' stroke='$ivory' stroke-width='14' stroke-linejoin='round'/><rect x='66' y='118' width='124' height='20' fill='$gold'/><polygon points='170,100 206,128 170,156' fill='$gold'/>",
    '#4a4f57',
    "<polygon points='128,44 202,86 202,170 128,212 54,170 54,86' fill='#2e3238' stroke='#f2a33a' stroke-width='12' stroke-linejoin='round'/><rect x='66' y='118' width='124' height='20' fill='#f2a33a'/><polygon points='170,100 206,128 170,156' fill='#f2a33a'/><circle cx='128' cy='128' r='10' fill='#2e3238'/>")
  'terraria' = @('#37504f',
    (Pickaxe $ivory $gold),
    '#6fc0f0',
    "<path d='M0 190 Q128 150 256 190 V256 H0Z' fill='#5aa83c'/><path d='M0 214 Q128 176 256 214 V256 H0Z' fill='#7a5230'/><rect x='116' y='96' width='14' height='96' fill='#6f4520'/><circle cx='123' cy='84' r='46' fill='#3d8f2e'/><circle cx='96' cy='104' r='28' fill='#4caf3a'/><circle cx='152' cy='102' r='30' fill='#4caf3a'/><polygon points='206,50 212,64 227,66 216,76 219,91 206,83 193,91 196,76 185,66 200,64' fill='#ffd84a'/>")
}

foreach ($v in 'tavora', 'classic') { New-Item -ItemType Directory -Force (Join-Path $Out $v) | Out-Null }
foreach ($id in $icons.Keys) {
  $e = $icons[$id]
  foreach ($pair in @(@('tavora', $e[0], $e[1]), @('classic', $e[2], $e[3]))) {
    $svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256' width='256' height='256'><rect width='256' height='256' fill='$($pair[1])'/>$($pair[2])</svg>"
    [IO.File]::WriteAllText((Join-Path $Out "$($pair[0])\$id.svg"), $svg, (New-Object Text.UTF8Encoding $false))
  }
}
"wrote $($icons.Count * 2) icons"
