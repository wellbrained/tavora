// Reads what the Docs files leave out from the game's IoStore files: item and
// building icons (written as square WebP files), the MAM research trees with
// their names in each requested culture and their node links, and the Space
// Elevator phases.
//
// dotnet run --project tools/asset-export -- <job.json>
//
// The job, written by tools/extract-data.ts:
//   { "paks": "<install>/FactoryGame/Content/Paks", "usmap": "<usmap>", "oodle": "<oo2core dll>",
//     "iconDir": "<dir>", "iconSize": 128, "icons": [{ "id": "Desc_IronPlate_C", "texture": "/Game/...X.X" }],
//     "cultures": ["en-US", "de"], "result": "<result.json>" }
// The result: { "icons": { "<id>": "<error, or empty when written>" },
//   "researchTrees": [{ "id", "name": { "<culture>": "<text>" },
//     "nodes": [{ "schematic": "Research_..._C", "at": { "x", "y" }, "parents": [{ "x", "y" }] }] }],
//   "gamePhases": [{ "phase": 1, "name": { "<culture>": "<text>" }, "lastTier": 4, "costs": [{ "item": "Desc_..._C", "amount": 50 }] }] }

using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using CUE4Parse.Compression;
using CUE4Parse.Encryption.Aes;
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Localization;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Readers;
using CUE4Parse.UE4.Versions;
using CUE4Parse_Conversion.Textures;
using Newtonsoft.Json.Linq;
using SkiaSharp;

var job = JsonNode.Parse(File.ReadAllText(args.Length == 1 ? args[0] : throw new ArgumentException("Pass the job file.")))!;
string Text(string key) => job[key]?.GetValue<string>() ?? throw new ArgumentException($"The job has no {key}.");

OodleHelper.Initialize(Text("oodle"));
var provider = new DefaultFileProvider(Text("paks"), SearchOption.TopDirectoryOnly,
    new VersionContainer(EGame.GAME_UE5_6), StringComparer.OrdinalIgnoreCase);
provider.MappingsContainer = new FileUsmapTypeMappingsProvider(Text("usmap"));
provider.Initialize();
// The game's archives are not encrypted; an empty key mounts them.
provider.SubmitKey(new FGuid(), new FAesKey(new byte[32]));
provider.PostMount();
if (provider.MountedVfs.Count == 0) throw new InvalidOperationException("No game archive could be mounted.");

var iconDir = Text("iconDir");
var iconSize = job["iconSize"]!.GetValue<int>();
Directory.CreateDirectory(iconDir);
TextureDecoder.UseAssetRipperTextureDecoder = true;
var icons = new SortedDictionary<string, string>(StringComparer.Ordinal);
foreach (var request in job["icons"]!.AsArray())
{
    var id = request!["id"]!.GetValue<string>();
    try
    {
        WriteIcon(request["texture"]!.GetValue<string>(), Path.Combine(iconDir, id + ".webp"));
        icons[id] = "";
    }
    catch (Exception error)
    {
        icons[id] = error.Message;
    }
}

var cultures = job["cultures"]!.AsArray().Select(c => c!.GetValue<string>()).ToArray();
var stringTables = cultures.ToDictionary(c => c, LoadStringTables);
var researchTrees = new JsonArray();
foreach (var path in provider.Files.Keys
    .Where(k => Regex.IsMatch(k, @"/Schematics/Research/BPD_ResearchTree_\w+\.uasset$", RegexOptions.IgnoreCase))
    .Order(StringComparer.Ordinal))
{
    var exports = JArray.FromObject(provider.LoadPackage(path).GetExports());
    var classDefault = exports.FirstOrDefault(e => ((string?)e["Name"])?.StartsWith("Default__") == true)
        ?? throw new InvalidOperationException($"{path} has no class default object.");
    var displayName = classDefault["Properties"]?["mDisplayName"]
        ?? throw new InvalidOperationException($"{path} has no mDisplayName.");
    var name = new JsonObject();
    foreach (var culture in cultures) name[culture] = ResolveText(displayName, stringTables[culture], path);
    // Each node's data struct names its schematic, its grid position and the positions of the nodes
    // that must be researched first, in properties whose names start with "Schematic", "Coordinates"
    // and "Parents" (the rest of each name is a generated suffix).
    var nodes = new JsonArray();
    foreach (var node in exports.Select(e => e["Properties"]?["mNodeDataStruct"]).OfType<JObject>())
    {
        var schematic = ClassName((string?)Field(node, "Schematic")?["ObjectName"])
            ?? throw new InvalidOperationException($"{path}: a node has no schematic.");
        var parents = Field(node, "Parents") as JArray ?? [];
        nodes.Add(new JsonObject
        {
            ["schematic"] = schematic,
            ["at"] = Coordinates(Field(node, "Coordinates"), path),
            ["parents"] = new JsonArray(parents.Select(p => (JsonNode)Coordinates(p, path)).ToArray()),
        });
    }
    researchTrees.Add(new JsonObject
    {
        ["id"] = Path.GetFileNameWithoutExtension(path) + "_C",
        ["name"] = name,
        ["nodes"] = nodes,
    });
}

// Space Elevator phases: what each delivery costs and the last milestone tier it opens. The Docs
// files leave these out.
var gamePhases = new JsonArray();
foreach (var path in provider.Files.Keys
    .Where(k => Regex.IsMatch(k, @"/GamePhases/GP_Project_Assembly_Phase_\d+\.uasset$", RegexOptions.IgnoreCase))
    .Order(StringComparer.Ordinal))
{
    var phase = JArray.FromObject(provider.LoadPackage(path).GetExports())
        .FirstOrDefault(e => (string?)e["Type"] == "FGGamePhase")?["Properties"]
        ?? throw new InvalidOperationException($"{path} has no FGGamePhase.");
    var name = new JsonObject();
    foreach (var culture in cultures) name[culture] = ResolveText(phase["mDisplayName"]!, stringTables[culture], path);
    var costs = (phase["mCosts"] as JArray ?? []).Select(cost => (JsonNode)new JsonObject
    {
        ["item"] = ClassName((string?)cost["ItemClass"]?["ObjectName"]) ?? throw new InvalidOperationException($"{path}: a cost has no item."),
        ["amount"] = (int?)cost["Amount"] ?? throw new InvalidOperationException($"{path}: a cost has no amount."),
    });
    gamePhases.Add(new JsonObject
    {
        ["phase"] = int.Parse(Regex.Match(path, @"Phase_(\d+)\.uasset$", RegexOptions.IgnoreCase).Groups[1].Value),
        ["name"] = name,
        ["lastTier"] = (int?)phase["mLastTierOfPhase"] ?? throw new InvalidOperationException($"{path} has no mLastTierOfPhase."),
        ["costs"] = new JsonArray(costs.ToArray()),
    });
}

var result = new JsonObject
{
    ["icons"] = new JsonObject(icons.Select(i => KeyValuePair.Create(i.Key, (JsonNode?)i.Value))),
    ["researchTrees"] = researchTrees,
    ["gamePhases"] = gamePhases,
};
File.WriteAllText(Text("result"), result.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine($"Wrote {icons.Count(i => i.Value == "")} of {icons.Count} icons, {researchTrees.Count} research trees and {gamePhases.Count} game phases.");

void WriteIcon(string texture, string file)
{
    // Docs name textures as "/Game/Path/Name.Name"; the provider maps /Game to the project's content.
    var loaded = provider.LoadPackageObject<UTexture2D>(texture);
    var decoded = loaded.Decode(ETexturePlatform.DesktopMobile) ?? throw new InvalidOperationException("Texture could not be decoded.");
    using var bitmap = decoded.ToSkBitmap();
    var scale = (float)iconSize / Math.Max(bitmap.Width, bitmap.Height);
    var width = Math.Max(1, (int)Math.Round(bitmap.Width * scale));
    var height = Math.Max(1, (int)Math.Round(bitmap.Height * scale));
    using var resized = bitmap.Resize(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Unpremul), SKFilterQuality.High)
        ?? throw new InvalidOperationException("Texture could not be resized.");
    using var square = new SKBitmap(new SKImageInfo(iconSize, iconSize, SKColorType.Rgba8888, SKAlphaType.Unpremul));
    using (var canvas = new SKCanvas(square))
    {
        canvas.Clear(SKColors.Transparent);
        canvas.DrawBitmap(resized, (iconSize - width) / 2f, (iconSize - height) / 2f);
    }
    using var image = SKImage.FromBitmap(square);
    using var webp = image.Encode(SKEncodedImageFormat.Webp, 90) ?? throw new InvalidOperationException("WebP encoding failed.");
    File.WriteAllBytes(file, webp.ToArray());
}

// Game texts live in string tables: English sources in CSV files, every culture in AllStringTables.locres.
Dictionary<string, Dictionary<string, string>> LoadStringTables(string culture)
{
    var path = provider.Files.Keys.SingleOrDefault(k => k.EndsWith($"/Localization/AllStringTables/{culture}/AllStringTables.locres", StringComparison.OrdinalIgnoreCase))
        ?? throw new InvalidOperationException($"No string tables for culture {culture}.");
    var resource = new FTextLocalizationResource(new FByteArchive(path, provider.SaveAsset(path)));
    return resource.Entries.ToDictionary(
        ns => ns.Key.Str,
        ns => ns.Value.ToDictionary(e => e.Key.Str, e => e.Value.LocalizedString));
}

string ResolveText(JToken text, Dictionary<string, Dictionary<string, string>> tables, string path)
{
    var table = (string?)text["TableId"];
    var key = (string?)text["Key"];
    if (table is null || key is null) throw new InvalidOperationException($"{path}: mDisplayName is not a string table entry.");
    if (tables.TryGetValue(table, out var entries) && entries.TryGetValue(key, out var value) && value.Length > 0) return value;
    throw new InvalidOperationException($"{path}: {table}/{key} is missing from the string tables.");
}

static JToken? Field(JObject node, string prefix) =>
    node.Properties().FirstOrDefault(p => p.Name.StartsWith(prefix + "_", StringComparison.Ordinal))?.Value;

static JsonObject Coordinates(JToken? at, string path)
{
    if (at is not JObject point) throw new InvalidOperationException($"{path}: a node position is missing.");
    // The archives leave out values equal to their default, so a missing axis is 0.
    int Axis(string axis) => (int?)Field(point, axis) ?? 0;
    return new JsonObject { ["x"] = Axis("X"), ["y"] = Axis("Y") };
}

static string? ClassName(string? objectName) =>
    objectName is null ? null : Regex.Match(objectName, @"'([\w\-]+_C)'$") is { Success: true } m ? m.Groups[1].Value : null;
