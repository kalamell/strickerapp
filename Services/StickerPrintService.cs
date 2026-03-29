using System.Drawing;
using System.Drawing.Printing;
using System.Drawing.Text;
using System.Reflection;
using QRCoder;
using StickerPrintApp.Models;

namespace StickerPrintApp.Services;

public class StickerPrintService
{
    public event Action<string>? OnLog;
    public string? LogoPath { get; set; }

    private static readonly string FontDir = System.IO.Path.Combine(AppContext.BaseDirectory, "Fonts");

    public string[] GetAvailablePrinters()
    {
        var printers = new string[PrinterSettings.InstalledPrinters.Count];
        PrinterSettings.InstalledPrinters.CopyTo(printers, 0);
        return printers;
    }

    public void PrintSticker(PrintJob job, string printerName)
    {
        if (string.IsNullOrWhiteSpace(printerName))
        {
            OnLog?.Invoke($"ERROR: No printer assigned for Printer #{job.PrinterId}. Skipping job {job.Key}.");
            return;
        }

        try
        {
            OnLog?.Invoke($"Printing job [{job.Key}] on printer: {printerName}");

            var printDoc = new PrintDocument();
            printDoc.PrinterSettings.PrinterName = printerName;

            if (!printDoc.PrinterSettings.IsValid)
            {
                OnLog?.Invoke($"ERROR: Printer '{printerName}' is not valid or not available.");
                return;
            }

            // Use printer's default paper size & landscape setting
            printDoc.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);

            printDoc.DocumentName = $"Sticker_{job.Key}";
            printDoc.PrintPage += (sender, e) =>
            {
                var bounds = e.PageBounds;
                OnLog?.Invoke($"Page bounds: {bounds.Width} x {bounds.Height} (landscape={e.PageSettings.Landscape})");
                DrawSticker(e.Graphics!, job, bounds.Width, bounds.Height);
                e.HasMorePages = false;
            };

            printDoc.Print();
            OnLog?.Invoke($"Print job [{job.Key}] sent to {printerName} successfully.");
        }
        catch (Exception ex)
        {
            OnLog?.Invoke($"ERROR printing [{job.Key}]: {ex.Message}");
        }
    }

    private Font GetFont(PrivateFontCollection pfc, string style, float size, FontStyle fontStyle)
    {
        var path = System.IO.Path.Combine(FontDir, $"IBMPlexSansThai-{style}.ttf");
        if (System.IO.File.Exists(path))
        {
            pfc.AddFontFile(path);
            return new Font(pfc.Families[^1], size, fontStyle);
        }
        // Fallback to Arial
        return new Font("Arial", size, fontStyle);
    }

    private void DrawSticker(Graphics g, PrintJob job, float pageW, float pageH)
    {
        // Unit: hundredths of an inch. 1mm ≈ 3.937
        float mmToUnit(float mm) => mm * 3.937f;

        // If paper is portrait (taller than wide), rotate to landscape
        if (pageH > pageW)
        {
            g.TranslateTransform(pageW, 0);
            g.RotateTransform(90);
            (pageW, pageH) = (pageH, pageW);
        }

        g.TextRenderingHint = TextRenderingHint.AntiAlias;

        // Shrink drawing area to prevent overflow onto 2nd page
        float padding = pageW * 0.06f;
        float margin = mmToUnit(3) + padding;

        // Load fonts
        using var pfc = new PrivateFontCollection();
        using var nameFontBold = GetFont(pfc, "Bold", 16, FontStyle.Bold);
        using var surnameFontBold = GetFont(pfc, "Bold", 16, FontStyle.Bold);
        using var positionFont = GetFont(pfc, "Regular", 10, FontStyle.Regular);
        using var eventHeaderFont = GetFont(pfc, "Medium", 10, FontStyle.Bold);
        using var eventFont = GetFont(pfc, "Regular", 9, FontStyle.Regular);
        using var qrTextFont = GetFont(pfc, "Bold", 9, FontStyle.Bold);

        var brush = Brushes.Black;
        var grayBrush = new SolidBrush(Color.FromArgb(80, 80, 80));

        // === Logo (bottom-left) ===
        float logoAreaH = 0;
        try
        {
            Image? logo = null;
            if (!string.IsNullOrEmpty(LogoPath) && System.IO.File.Exists(LogoPath))
                logo = Image.FromFile(LogoPath);
            else
            {
                var assembly = Assembly.GetExecutingAssembly();
                var logoStream = assembly.GetManifestResourceStream("StickerPrintApp.logo.png");
                if (logoStream != null)
                    logo = Image.FromStream(logoStream);
            }

            if (logo != null)
            {
                using (logo)
                {
                    float logoMaxH = mmToUnit(7);
                    float scale = logoMaxH / logo.Height;
                    float logoW = logo.Width * scale;
                    float logoH = logo.Height * scale;
                    float logoX = mmToUnit(5);
                    float logoY = pageH - mmToUnit(3) - logoH;
                    g.DrawImage(logo, logoX, logoY, logoW, logoH);
                    logoAreaH = logoH + mmToUnit(4);
                }
            }
        }
        catch { }

        // === QR Code (right side, vertically centered in content area) ===
        float contentTop = margin;
        float contentBottom = pageH - logoAreaH;
        float contentH = contentBottom - contentTop;
        float qrSize = contentH * 0.75f;
        float qrRightMargin = margin + mmToUnit(2);
        float qrX = pageW - qrRightMargin - qrSize;
        float qrY = contentTop + (contentH - qrSize) * 0.35f;

        if (!string.IsNullOrWhiteSpace(job.QrData))
        {
            using var qrGenerator = new QRCodeGenerator();
            using var qrCodeData = qrGenerator.CreateQrCode(job.QrData, QRCodeGenerator.ECCLevel.M);
            using var qrCode = new PngByteQRCode(qrCodeData);
            var qrBytes = qrCode.GetGraphic(10);
            using var ms = new System.IO.MemoryStream(qrBytes);
            using var qrImage = Image.FromStream(ms);

            g.DrawImage(qrImage, qrX, qrY, qrSize, qrSize);

            // FAR-000xxx label below QR
            var displayText = job.QrData;
            var hashIdx = job.QrData.IndexOf('#');
            if (hashIdx > 0)
            {
                var numPart = job.QrData.Substring(0, hashIdx);
                if (int.TryParse(numPart, out var num))
                    displayText = $"FAR-{num:D6}";
            }

            var qrTextSize = g.MeasureString(displayText, qrTextFont);
            float qrTextX = qrX + (qrSize - qrTextSize.Width) / 2;
            float qrTextY = qrY + qrSize + mmToUnit(1);
            g.DrawString(displayText, qrTextFont, brush, qrTextX, qrTextY);
        }

        // === Left side ===
        float leftX = margin;
        float leftY = margin + mmToUnit(3); // padding top
        float leftMaxWidth = qrX - leftX - mmToUnit(3);

        // Name (large bold)
        float nameCellH = nameFontBold.Size * 1.35f;
        g.DrawString(job.Name, nameFontBold, brush, leftX, leftY);
        leftY += nameCellH;

        // Surname — flush left, tight to name
        float surnameCellH = surnameFontBold.Size * 1.35f;
        g.DrawString(job.Surname, surnameFontBold, brush, leftX, leftY);
        leftY += surnameCellH;

        // Position — flush left, slightly below surname
        leftY += mmToUnit(2);
        float posCellH = positionFont.GetHeight(g);
        g.DrawString(job.Position, positionFont, grayBrush, leftX, leftY);
        leftY += posCellH;

        // Events section with header and bullet points
        if (job.Events != null && job.Events.Count > 0)
        {
            // Header "ลงทะเบียน"
            float headerCellH = eventHeaderFont.Size * 1.2f;
            g.DrawString("ลงทะเบียน", eventHeaderFont, brush, leftX, leftY);
            leftY += headerCellH + mmToUnit(1);

            // Bullet items — tight spacing
            float bulletIndent = mmToUnit(3);
            float evtCellH = eventFont.Size * 1.6f;
            foreach (var evt in job.Events)
            {
                var bulletText = $"•  {evt}";
                g.DrawString(bulletText, eventFont, brush, leftX + bulletIndent, leftY);
                leftY += evtCellH;
            }
        }

        grayBrush.Dispose();
    }
}
