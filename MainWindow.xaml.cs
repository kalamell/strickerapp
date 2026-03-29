using Microsoft.Win32;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using StickerPrintApp.Models;
using StickerPrintApp.Services;

namespace StickerPrintApp;

public partial class MainWindow : Window
{
    private FirebaseService? _firebaseService;
    private readonly StickerPrintService _printService = new();
    private int _jobCount;
    private int _skipCount;
    private List<QueueItemViewModel> _allQueueItems = new();
    private List<QueueItemViewModel> _filteredQueueItems = new();

    private int StationId => cbStationId.SelectedIndex + 1;

    private string SelectedPrinterName
    {
        get
        {
            var selected = cbPrinterDevice.SelectedItem as string;
            return selected == "(None)" ? string.Empty : selected ?? string.Empty;
        }
    }

    public MainWindow()
    {
        InitializeComponent();
        LoadPrinters();
        _printService.OnLog += Log;
        cbStationId.SelectionChanged += (_, _) => UpdateStationLabel();
        UpdateStationLabel();
    }

    private void UpdateStationLabel()
    {
        txtStationLabel.Text = $"Printer #{StationId}";
        Title = $"Sticker Print Station — Printer #{StationId}";
    }

    private void LoadPrinters()
    {
        var printers = _printService.GetAvailablePrinters();
        var printerList = new List<string> { "(None)" };
        printerList.AddRange(printers);

        cbPrinterDevice.ItemsSource = printerList;
        cbPrinterDevice.SelectedIndex = printers.Length > 0 ? 1 : 0;

        Log($"Found {printers.Length} printer(s): {string.Join(", ", printers)}");
    }

    private void BtnStart_Click(object sender, RoutedEventArgs e)
    {
        var url = txtFirebaseUrl.Text.Trim();
        if (string.IsNullOrWhiteSpace(url) || url.Contains("YOUR-PROJECT"))
        {
            MessageBox.Show("Please enter a valid Firebase Realtime Database URL.",
                "Configuration Error", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        if (string.IsNullOrEmpty(SelectedPrinterName))
        {
            MessageBox.Show("Please select a printer device for this station.",
                "Configuration Error", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        try
        {
            var keyFile = txtKeyFile.Text.Trim();
            var keyFilePath = string.IsNullOrEmpty(keyFile) ? null : keyFile;

            _firebaseService?.Dispose();
            _firebaseService = new FirebaseService(url, keyFilePath);
            _firebaseService.OnLog += Log;
            _firebaseService.OnNewPrintJob += OnNewPrintJob;
            _firebaseService.StartListening();

            btnStart.IsEnabled = false;
            btnStop.IsEnabled = true;
            txtFirebaseUrl.IsEnabled = false;
            txtKeyFile.IsEnabled = false;
            btnBrowseKey.IsEnabled = false;
            cbStationId.IsEnabled = false;
            cbPrinterDevice.IsEnabled = false;

            txtStatus.Text = "Online";
            statusDot.Fill = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#FF00B894"));
            statusIconBg.Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#FFE6FAF5"));

            Log($"Station Printer #{StationId} started — accepting printerId={StationId} only");
            Log($"Using printer device: {SelectedPrinterName}");
        }
        catch (Exception ex)
        {
            Log($"ERROR: {ex.Message}");
            MessageBox.Show($"Failed to connect: {ex.Message}", "Error",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void BtnStop_Click(object sender, RoutedEventArgs e)
    {
        _firebaseService?.StopListening();

        btnStart.IsEnabled = true;
        btnStop.IsEnabled = false;
        txtFirebaseUrl.IsEnabled = true;
        txtKeyFile.IsEnabled = true;
        btnBrowseKey.IsEnabled = true;
        cbStationId.IsEnabled = true;
        cbPrinterDevice.IsEnabled = true;

        txtStatus.Text = "Offline";
        statusDot.Fill = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#FFE17055"));
        statusIconBg.Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#FFFDECEA"));

        Log("Stopped listening.");
    }

    private void OnNewPrintJob(string key, PrintJob job)
    {
        Dispatcher.Invoke(async () =>
        {
            try
            {
                if (job.PrinterId != StationId)
                {
                    Log($"SKIP [{key}] printerId={job.PrinterId} — not for this station #{StationId}");
                    _skipCount++;
                    txtSkipCount.Text = _skipCount.ToString();
                    return;
                }

                Log($"MATCH [{key}] \"{job.Name}\" ({job.TicketType}) — printing now...");
                _printService.PrintSticker(job, SelectedPrinterName);

                if (_firebaseService != null)
                {
                    await _firebaseService.MarkAsPrintedAsync("print_queue", key);
                }

                _jobCount++;
                txtJobCount.Text = _jobCount.ToString();
            }
            catch (Exception ex)
            {
                Log($"ERROR [{key}]: {ex.Message}");
            }
        });
    }

    private void BtnBrowseKey_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new OpenFileDialog
        {
            Title = "Select Firebase Service Account Key File",
            Filter = "JSON files (*.json)|*.json|All files (*.*)|*.*",
            DefaultExt = ".json"
        };

        if (dlg.ShowDialog() == true)
        {
            txtKeyFile.Text = dlg.FileName;
            Log($"Key file selected: {dlg.FileName}");
        }
    }

    private void BtnBrowseLogo_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new OpenFileDialog
        {
            Title = "Select Logo Image",
            Filter = "Image files (*.png;*.jpg;*.bmp)|*.png;*.jpg;*.bmp|All files (*.*)|*.*"
        };

        if (dlg.ShowDialog() == true)
        {
            txtLogoPath.Text = dlg.FileName;
            _printService.LogoPath = dlg.FileName;
            Log($"Logo changed: {dlg.FileName}");
        }
    }

    private void BtnRefreshPrinters_Click(object sender, RoutedEventArgs e)
    {
        LoadPrinters();
        Log("Printer list refreshed.");
    }

    private void BtnClearLog_Click(object sender, RoutedEventArgs e)
    {
        lstLog.Items.Clear();
    }

    // ===== Queue Browser =====

    private async void BtnFetchQueue_Click(object sender, RoutedEventArgs e)
    {
        var url = txtFirebaseUrl.Text.Trim();
        if (string.IsNullOrWhiteSpace(url) || url.Contains("YOUR-PROJECT"))
        {
            MessageBox.Show("Please enter a valid Firebase URL first.", "Error", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        try
        {
            btnFetchQueue.IsEnabled = false;
            Log("Fetching queue from Firebase...");

            var keyFile = txtKeyFile.Text.Trim();
            var keyFilePath = string.IsNullOrEmpty(keyFile) ? null : keyFile;

            using var tempService = new FirebaseService(url, keyFilePath);
            var items = await tempService.FetchAllAsync();

            _allQueueItems = items.Select(i => QueueItemViewModel.FromPrintJob(i.Key, i.Job)).ToList();
            ApplySearchFilter();

            Log($"Loaded {_allQueueItems.Count} items from Firebase.");
        }
        catch (Exception ex)
        {
            Log($"ERROR fetching queue: {ex.Message}");
            MessageBox.Show($"Failed to fetch: {ex.Message}", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            btnFetchQueue.IsEnabled = true;
        }
    }

    private void TxtSearch_TextChanged(object sender, TextChangedEventArgs e)
    {
        ApplySearchFilter();
    }

    private void ApplySearchFilter()
    {
        var query = txtSearch.Text.Trim().ToLowerInvariant();

        if (string.IsNullOrEmpty(query))
        {
            _filteredQueueItems = new List<QueueItemViewModel>(_allQueueItems);
        }
        else
        {
            _filteredQueueItems = _allQueueItems
                .Where(i =>
                    i.Name.ToLowerInvariant().Contains(query) ||
                    i.Surname.ToLowerInvariant().Contains(query) ||
                    i.QrData.ToLowerInvariant().Contains(query))
                .ToList();
        }

        dgQueue.ItemsSource = _filteredQueueItems;
        var selectedCount = _filteredQueueItems.Count(i => i.IsSelected);
        txtQueueInfo.Text = $"{_filteredQueueItems.Count} items shown, {selectedCount} selected";
    }

    private void ChkSelectAll_Click(object sender, RoutedEventArgs e)
    {
        var chk = sender as CheckBox;
        bool check = chk?.IsChecked == true;
        foreach (var item in _filteredQueueItems)
            item.IsSelected = check;
        dgQueue.Items.Refresh();
        UpdateQueueInfo();
    }

    private void BtnSelectUnprinted_Click(object sender, RoutedEventArgs e)
    {
        foreach (var item in _filteredQueueItems)
            item.IsSelected = !item.Printed;
        dgQueue.Items.Refresh();
        UpdateQueueInfo();
    }

    private async void BtnPrintSelected_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrEmpty(SelectedPrinterName))
        {
            MessageBox.Show("Please select a printer device first.", "Error", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var selected = _allQueueItems.Where(i => i.IsSelected).ToList();
        if (selected.Count == 0)
        {
            MessageBox.Show("No items selected.", "Info", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        var result = MessageBox.Show($"Print {selected.Count} sticker(s)?", "Confirm Print",
            MessageBoxButton.YesNo, MessageBoxImage.Question);
        if (result != MessageBoxResult.Yes) return;

        btnPrintSelected.IsEnabled = false;
        Log($"Printing {selected.Count} selected items...");

        foreach (var item in selected)
        {
            try
            {
                var job = item.ToPrintJob();
                _printService.PrintSticker(job, SelectedPrinterName);
                Log($"Printed: {item.Name} {item.Surname} ({item.QrData})");

                // Mark as printed in Firebase
                try
                {
                    var url = txtFirebaseUrl.Text.Trim();
                    var keyFile = txtKeyFile.Text.Trim();
                    var keyFilePath = string.IsNullOrEmpty(keyFile) ? null : keyFile;
                    using var svc = new FirebaseService(url, keyFilePath);
                    await svc.MarkAsPrintedAsync("print_queue", item.Key);
                    item.Printed = true;
                }
                catch { }

                item.IsSelected = false;
                _jobCount++;
                txtJobCount.Text = _jobCount.ToString();
            }
            catch (Exception ex)
            {
                Log($"ERROR printing {item.Name}: {ex.Message}");
            }
        }

        dgQueue.Items.Refresh();
        UpdateQueueInfo();
        btnPrintSelected.IsEnabled = true;
        Log("Batch print completed.");
    }

    private async void BtnDeleteSelected_Click(object sender, RoutedEventArgs e)
    {
        var selected = _allQueueItems.Where(i => i.IsSelected).ToList();
        if (selected.Count == 0)
        {
            MessageBox.Show("No items selected.", "Info", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        var result = MessageBox.Show($"Delete {selected.Count} item(s) from Firebase?\nThis cannot be undone.", "Confirm Delete",
            MessageBoxButton.YesNo, MessageBoxImage.Warning);
        if (result != MessageBoxResult.Yes) return;

        btnDeleteSelected.IsEnabled = false;
        Log($"Deleting {selected.Count} items from Firebase...");

        var url = txtFirebaseUrl.Text.Trim();
        var keyFile = txtKeyFile.Text.Trim();
        var keyFilePath = string.IsNullOrEmpty(keyFile) ? null : keyFile;

        try
        {
            using var svc = new FirebaseService(url, keyFilePath);
            foreach (var item in selected)
            {
                await svc.DeleteJobAsync("print_queue", item.Key);
                _allQueueItems.Remove(item);
                Log($"Deleted: {item.Name} {item.Surname} ({item.QrData})");
            }
            ApplySearchFilter();
            Log($"Deleted {selected.Count} items.");
        }
        catch (Exception ex)
        {
            Log($"ERROR deleting: {ex.Message}");
        }
        finally
        {
            btnDeleteSelected.IsEnabled = true;
        }
    }

    private void UpdateQueueInfo()
    {
        var selectedCount = _filteredQueueItems.Count(i => i.IsSelected);
        txtQueueInfo.Text = $"{_filteredQueueItems.Count} items shown, {selectedCount} selected";
    }

    private void Log(string message)
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.Invoke(() => Log(message));
            return;
        }

        var entry = $"[{DateTime.Now:HH:mm:ss}] {message}";
        lstLog.Items.Insert(0, entry);

        if (lstLog.Items.Count > 500)
        {
            lstLog.Items.RemoveAt(lstLog.Items.Count - 1);
        }
    }

    private void Window_Closing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        _firebaseService?.Dispose();
    }
}
