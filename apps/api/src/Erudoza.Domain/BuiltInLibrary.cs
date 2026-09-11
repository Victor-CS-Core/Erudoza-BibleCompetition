using System.Security.Cryptography;
using System.Text;

namespace Erudoza.Domain;

public static class BuiltInLibrary
{
    public static readonly Guid OrganizationId = Guid.Parse("00000000-0000-4000-8000-000000000066");
    public const string TranslationId = "nkjv";
    public const string TranslationName = "New King James Version";
    public const int Version = 1;
    public static readonly string[] BookKeys = "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV".Split(' ');

    public static Guid StableId(string key)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes("erudoza:nkjv:v1:" + key));
        bytes[6] = (byte)((bytes[6] & 0x0f) | 0x50);
        bytes[8] = (byte)((bytes[8] & 0x3f) | 0x80);
        return Guid.ParseExact(Convert.ToHexString(bytes.AsSpan(0, 16)), "N");
    }
}
