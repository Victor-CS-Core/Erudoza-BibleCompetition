using System.Security.Cryptography;
using System.Text;

namespace Erudoza.Domain;

public static class ContentHashing
{
    public static string Compute(string canonicalText, string bookKey, int chapter, int verse, int ordinal)
    {
        var material = $"{bookKey}|{chapter}|{verse}|{ordinal}|{canonicalText}";
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(material));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
