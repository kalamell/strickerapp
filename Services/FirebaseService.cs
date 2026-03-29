using System.Reactive.Linq;
using Firebase.Database;
using Firebase.Database.Query;
using Google.Apis.Auth.OAuth2;
using StickerPrintApp.Models;

namespace StickerPrintApp.Services;

public class FirebaseService : IDisposable
{
    private readonly FirebaseClient _client;
    private IDisposable? _subscription;

    public event Action<string, PrintJob>? OnNewPrintJob;
    public event Action<string>? OnLog;

    public FirebaseService(string firebaseUrl, string? keyFilePath = null)
    {
        if (!string.IsNullOrWhiteSpace(keyFilePath))
        {
            var credential = GoogleCredential
                .FromFile(keyFilePath)
                .CreateScoped("https://www.googleapis.com/auth/firebase.database", "https://www.googleapis.com/auth/userinfo.email");

            var token = credential.UnderlyingCredential.GetAccessTokenForRequestAsync().Result;

            _client = new FirebaseClient(firebaseUrl, new FirebaseOptions
            {
                AuthTokenAsyncFactory = () => Task.FromResult(token)
            });
        }
        else
        {
            _client = new FirebaseClient(firebaseUrl);
        }
    }

    public void StartListening(string path = "print_queue")
    {
        OnLog?.Invoke($"Connecting to Firebase path: /{path}");

        _subscription = _client
            .Child(path)
            .AsObservable<PrintJob>()
            .Where(e => e.Object != null && !e.Object.Printed)
            .Subscribe(
                e =>
                {
                    var job = e.Object;
                    job.Key = e.Key;
                    OnLog?.Invoke($"New job received: {job.Name} (Printer {job.PrinterId}) Key={e.Key}");
                    OnNewPrintJob?.Invoke(e.Key, job);
                },
                ex =>
                {
                    OnLog?.Invoke($"Firebase error: {ex.Message}");
                }
            );

        OnLog?.Invoke("Firebase listener started.");
    }

    public async Task<List<(string Key, PrintJob Job)>> FetchAllAsync(string path = "print_queue")
    {
        var result = new List<(string Key, PrintJob Job)>();
        var items = await _client.Child(path).OnceAsync<PrintJob>();
        foreach (var item in items)
        {
            var job = item.Object;
            job.Key = item.Key;
            result.Add((item.Key, job));
        }
        return result;
    }

    public async Task DeleteJobAsync(string path, string key)
    {
        await _client.Child(path).Child(key).DeleteAsync();
        OnLog?.Invoke($"Deleted job {key} from Firebase.");
    }

    public async Task MarkAsPrintedAsync(string path, string key)
    {
        await _client
            .Child(path)
            .Child(key)
            .Child("printed")
            .PutAsync(true);

        OnLog?.Invoke($"Marked job {key} as printed in Firebase.");
    }

    public void StopListening()
    {
        _subscription?.Dispose();
        _subscription = null;
        OnLog?.Invoke("Firebase listener stopped.");
    }

    public void Dispose()
    {
        StopListening();
        _client.Dispose();
    }
}
