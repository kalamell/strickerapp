using Newtonsoft.Json;

namespace StickerPrintApp.Models;

public class PrintJob
{
    [JsonProperty("key")]
    public string Key { get; set; } = string.Empty;

    [JsonProperty("name")]
    public string Name { get; set; } = string.Empty;

    [JsonProperty("surname")]
    public string Surname { get; set; } = string.Empty;

    [JsonProperty("position")]
    public string Position { get; set; } = string.Empty;

    [JsonProperty("ticketType")]
    public string TicketType { get; set; } = string.Empty;

    [JsonProperty("printerId")]
    public int PrinterId { get; set; } = 1;

    [JsonProperty("timestamp")]
    public long Timestamp { get; set; }

    [JsonProperty("printed")]
    public bool Printed { get; set; }

    [JsonProperty("qrData")]
    public string QrData { get; set; } = string.Empty;

    [JsonProperty("events")]
    public List<string> Events { get; set; } = new();
}
