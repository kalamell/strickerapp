using System.ComponentModel;

namespace StickerPrintApp.Models;

public class QueueItemViewModel : INotifyPropertyChanged
{
    private bool _isSelected;

    public string Key { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Surname { get; set; } = string.Empty;
    public string Position { get; set; } = string.Empty;
    public string QrData { get; set; } = string.Empty;
    public List<string> Events { get; set; } = new();
    public int PrinterId { get; set; }
    public bool Printed { get; set; }
    public string TicketType { get; set; } = string.Empty;

    public bool IsSelected
    {
        get => _isSelected;
        set { _isSelected = value; OnPropertyChanged(nameof(IsSelected)); }
    }

    public string EventsDisplay => Events.Count > 0 ? string.Join(", ", Events) : "";
    public string PrintedDisplay => Printed ? "Yes" : "No";

    public PrintJob ToPrintJob() => new()
    {
        Key = Key,
        Name = Name,
        Surname = Surname,
        Position = Position,
        QrData = QrData,
        Events = Events,
        PrinterId = PrinterId,
        Printed = Printed,
        TicketType = TicketType
    };

    public static QueueItemViewModel FromPrintJob(string key, PrintJob job) => new()
    {
        Key = key,
        Name = job.Name,
        Surname = job.Surname,
        Position = job.Position,
        QrData = job.QrData,
        Events = job.Events ?? new(),
        PrinterId = job.PrinterId,
        Printed = job.Printed,
        TicketType = job.TicketType
    };

    public event PropertyChangedEventHandler? PropertyChanged;
    private void OnPropertyChanged(string name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
