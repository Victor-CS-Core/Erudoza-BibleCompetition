using System.Collections;
using System.Data;
using System.Data.Common;
using System.Globalization;
using System.Text;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Erudoza.IntegrationTests;

/// <summary>Counts actual values crossing both EF and the private ADO reader; never retains values or SQL.</summary>
internal sealed class PbeChapterResourceMeter : DbCommandInterceptor, IObserver<KeyValuePair<string, object?>>, IDisposable
{
    readonly IDisposable subscription;
    public long Statements { get; private set; }
    public long Rows { get; private set; }
    public long ValueBytes { get; private set; }
    public long MaxQueryValueBytes { get; private set; }
    public long MaxBoundBytes { get; private set; }
    public bool Active { get; set; }
    public PbeChapterResourceMeter() => subscription = PbeChapterJsonReader.Diagnostics.Subscribe(this);
    public void Reset() { Statements = 0; Rows = 0; ValueBytes = 0; MaxQueryValueBytes = 0; MaxBoundBytes = 0; }
    static long Bytes(object? value) => value is DBNull ? 0 : Encoding.UTF8.GetByteCount(Convert.ToString(value, CultureInfo.InvariantCulture) ?? "");
    void Command(DbCommand command)
    {
        if (!Active) return; Statements++;
        MaxBoundBytes = Math.Max(MaxBoundBytes, command.Parameters.Cast<DbParameter>().Select(p => Bytes(p.Value)).DefaultIfEmpty().Max());
    }
    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default) { Command(command); return ValueTask.FromResult(result); }
    public override ValueTask<DbDataReader> ReaderExecutedAsync(DbCommand command, CommandExecutedEventData eventData, DbDataReader result, CancellationToken cancellationToken = default)
        => ValueTask.FromResult<DbDataReader>(Active ? new MeasuredReader(result, this) : result);
    public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default) { Command(command); return ValueTask.FromResult(result); }
    public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<object> result, CancellationToken cancellationToken = default) { Command(command); return ValueTask.FromResult(result); }
    public void OnNext(KeyValuePair<string, object?> value)
    {
        if (!Active || value.Value is not PbeChapterJsonReader.QueryMetric metric) return;
        Statements += metric.Statements; Rows += metric.Rows; ValueBytes += metric.ValueBytes; MaxQueryValueBytes = Math.Max(MaxQueryValueBytes, metric.ValueBytes); MaxBoundBytes = Math.Max(MaxBoundBytes, metric.MaxBoundBytes);
    }
    public void OnError(Exception error) { }
    public void OnCompleted() { }
    public void Dispose() => subscription.Dispose();
    sealed class MeasuredReader(DbDataReader inner, PbeChapterResourceMeter meter) : DbDataReader
    {
        long queryBytes;
        void Record(bool hasRow) { if (!hasRow) return; meter.Rows++; for (var i = 0; i < inner.FieldCount; i++) { var bytes = Bytes(inner.GetValue(i)); meter.ValueBytes += bytes; queryBytes += bytes; } meter.MaxQueryValueBytes = Math.Max(meter.MaxQueryValueBytes, queryBytes); }
        public override bool Read() { var result = inner.Read(); Record(result); return result; }
        public override async Task<bool> ReadAsync(CancellationToken cancellationToken) { var result = await inner.ReadAsync(cancellationToken); Record(result); return result; }
        public override int Depth => inner.Depth;
        public override int FieldCount => inner.FieldCount;
        public override bool HasRows => inner.HasRows;
        public override bool IsClosed => inner.IsClosed;
        public override int RecordsAffected => inner.RecordsAffected;
        public override object this[int ordinal] => inner[ordinal];
        public override object this[string name] => inner[name];
        public override bool GetBoolean(int ordinal) => inner.GetBoolean(ordinal);
        public override byte GetByte(int ordinal) => inner.GetByte(ordinal);
        public override long GetBytes(int ordinal, long dataOffset, byte[]? buffer, int bufferOffset, int length) => inner.GetBytes(ordinal, dataOffset, buffer, bufferOffset, length);
        public override char GetChar(int ordinal) => inner.GetChar(ordinal);
        public override long GetChars(int ordinal, long dataOffset, char[]? buffer, int bufferOffset, int length) => inner.GetChars(ordinal, dataOffset, buffer, bufferOffset, length);
        public override string GetDataTypeName(int ordinal) => inner.GetDataTypeName(ordinal);
        public override DateTime GetDateTime(int ordinal) => inner.GetDateTime(ordinal);
        public override decimal GetDecimal(int ordinal) => inner.GetDecimal(ordinal);
        public override double GetDouble(int ordinal) => inner.GetDouble(ordinal);
        public override Type GetFieldType(int ordinal) => inner.GetFieldType(ordinal);
        public override float GetFloat(int ordinal) => inner.GetFloat(ordinal);
        public override Guid GetGuid(int ordinal) => inner.GetGuid(ordinal);
        public override short GetInt16(int ordinal) => inner.GetInt16(ordinal);
        public override int GetInt32(int ordinal) => inner.GetInt32(ordinal);
        public override long GetInt64(int ordinal) => inner.GetInt64(ordinal);
        public override string GetName(int ordinal) => inner.GetName(ordinal);
        public override int GetOrdinal(string name) => inner.GetOrdinal(name);
        public override string GetString(int ordinal) => inner.GetString(ordinal);
        public override object GetValue(int ordinal) => inner.GetValue(ordinal);
        public override T GetFieldValue<T>(int ordinal) => inner.GetFieldValue<T>(ordinal);
        public override Task<T> GetFieldValueAsync<T>(int ordinal, CancellationToken cancellationToken) => inner.GetFieldValueAsync<T>(ordinal, cancellationToken);
        public override int GetValues(object[] values) => inner.GetValues(values);
        public override bool IsDBNull(int ordinal) => inner.IsDBNull(ordinal);
        public override bool NextResult() => inner.NextResult();
        public override Task<bool> NextResultAsync(CancellationToken cancellationToken) => inner.NextResultAsync(cancellationToken);
        public override IEnumerator GetEnumerator() => ((IEnumerable)inner).GetEnumerator();
        public override DataTable? GetSchemaTable() => inner.GetSchemaTable();
        public override void Close() => inner.Close();
        protected override void Dispose(bool disposing) { if (disposing) inner.Dispose(); base.Dispose(disposing); }
        public override ValueTask DisposeAsync() => inner.DisposeAsync();
    }
}
