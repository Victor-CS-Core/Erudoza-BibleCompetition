using System.Net;
using Erudoza.Domain;
using Erudoza.Infrastructure.Content;
using FluentAssertions;
using Microsoft.Extensions.Caching.Memory;

namespace Erudoza.IntegrationTests;

public sealed class BibleApiTextClientTests
{
    private const string Books = """{"books":[{"id":"JUD","name":"Jude"}]}""";
    private const string Chapters = """{"chapters":[{"book_id":"JUD","chapter":1}]}""";

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("{}")]
    [InlineData("{\"books\":null}")]
    [InlineData("{\"books\":{}}")]
    [InlineData("{\"books\":[null]}")]
    [InlineData("{\"books\":[{}]}")]
    [InlineData("{\"books\":[{\"id\":123,\"name\":\"Jude\"}]}")]
    [InlineData("{\"books\":[{\"id\":\"JUD\",\"name\":null}]}")]
    [InlineData("{\"books\":[{\"id\":\"JUD\",\"name\":\" \"}]}")]
    [InlineData("{\"books\":[{\"id\":\"jude\",\"name\":\"Jude\"}]}")]
    [InlineData("{not-json")]
    public async Task Invalid_books_return_a_domain_error_and_do_not_poison_the_cache(string malformed)
    {
        using var fixture = ClientFixture.Responses(malformed, Books);
        var failure = async () => await fixture.Client.GetBooksAsync("web", CancellationToken.None);
        await failure.Should().ThrowAsync<DomainException>().WithMessage("*unreadable book information*");
        var recovered = await fixture.Client.GetBooksAsync("web", CancellationToken.None);
        recovered.Should().ContainSingle(book => book.BookKey == "JUD" && book.Name == "Jude");
        await fixture.Client.GetBooksAsync("web", CancellationToken.None);
        fixture.RequestCount.Should().Be(2, "only validated metadata should be cached");
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("{}")]
    [InlineData("{\"chapters\":null}")]
    [InlineData("{\"chapters\":{}}")]
    [InlineData("{\"chapters\":[null]}")]
    [InlineData("{\"chapters\":[{}]}")]
    [InlineData("{\"chapters\":[{\"book_id\":null,\"chapter\":1}]}")]
    [InlineData("{\"chapters\":[{\"book_id\":\"GEN\",\"chapter\":1}]}")]
    [InlineData("{\"chapters\":[{\"book_id\":\"JUD\",\"chapter\":\"1\"}]}")]
    [InlineData("{\"chapters\":[{\"book_id\":\"JUD\",\"chapter\":0}]}")]
    [InlineData("{\"chapters\":[{\"book_id\":\"JUD\",\"chapter\":-1}]}")]
    [InlineData("{\"chapters\":[{\"book_id\":\"JUD\",\"chapter\":1.5}]}")]
    [InlineData("{\"chapters\":[{\"book_id\":\"JUD\",\"chapter\":2147483648}]}")]
    public async Task Invalid_chapters_return_a_domain_error_and_do_not_poison_the_cache(string malformed)
    {
        using var fixture = ClientFixture.Responses(malformed, Chapters);
        var failure = async () => await fixture.Client.GetChaptersAsync("web", "JUD", CancellationToken.None);
        await failure.Should().ThrowAsync<DomainException>().WithMessage("*unreadable chapter information*");
        (await fixture.Client.GetChaptersAsync("web", "JUD", CancellationToken.None)).Should().Equal(1);
        await fixture.Client.GetChaptersAsync("web", "JUD", CancellationToken.None);
        fixture.RequestCount.Should().Be(2, "invalid metadata must be retried instead of cached");
    }

    [Fact]
    public async Task Valid_chapters_are_sorted_deduplicated_and_cached()
    {
        using var fixture = ClientFixture.Responses("""{"chapters":[{"book_id":"GEN","chapter":3},{"book_id":"GEN","chapter":1},{"book_id":"GEN","chapter":3}]}""");
        (await fixture.Client.GetChaptersAsync("web", "GEN", CancellationToken.None)).Should().Equal(1, 3);
        (await fixture.Client.GetChaptersAsync("web", "GEN", CancellationToken.None)).Should().Equal(1, 3);
        fixture.RequestCount.Should().Be(1);
    }

    [Fact]
    public async Task Metadata_timeouts_report_a_recoverable_domain_error()
    {
        using var fixture = new ClientFixture((_, _) => throw new TaskCanceledException("HTTP timeout"));
        var action = async () => await fixture.Client.GetBooksAsync("web", CancellationToken.None);
        await action.Should().ThrowAsync<DomainException>().WithMessage("*catalog timed out*Try again*");
    }

    [Fact]
    public async Task Caller_cancellation_remains_cancellation()
    {
        using var cancellation = new CancellationTokenSource();
        using var fixture = new ClientFixture((_, token) => { cancellation.Cancel(); throw new OperationCanceledException(token); });
        var action = async () => await fixture.Client.GetChaptersAsync("web", "JUD", cancellation.Token);
        await action.Should().ThrowAsync<OperationCanceledException>();
    }

    private sealed class ClientFixture : IDisposable, IHttpClientFactory
    {
        private readonly MemoryCache cache = new(new MemoryCacheOptions());
        private readonly HttpClient http;
        private readonly StubHandler handler;
        public BibleApiTextClient Client { get; }
        public int RequestCount => handler.RequestCount;
        public ClientFixture(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> response)
        {
            handler = new StubHandler(response);
            http = new HttpClient(handler) { BaseAddress = new Uri("https://catalog.test/") };
            Client = new BibleApiTextClient(this, cache);
        }
        public static ClientFixture Responses(params string[] values)
        {
            var responses = new Queue<string>(values);
            return new ClientFixture((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(responses.Dequeue()) }));
        }
        public HttpClient CreateClient(string name) => http;
        public void Dispose() { http.Dispose(); cache.Dispose(); }
    }
    private sealed class StubHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> response) : HttpMessageHandler
    {
        public int RequestCount { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestCount++;
            return response(request, cancellationToken);
        }
    }
}
