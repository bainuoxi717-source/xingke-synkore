#include "../firmware/classroom_recorder/sha256.h"
#include <cstdio>
#include <cstring>

static bool check(const char* input, size_t length, const char* expected, size_t chunk) {
    Sha256 sha;
    uint8_t digest[32];
    char hex[65];
    for (size_t offset = 0; offset < length; offset += chunk) {
        const size_t count = length - offset < chunk ? length - offset : chunk;
        sha.update(reinterpret_cast<const uint8_t*>(input + offset), count);
    }
    sha.final(digest);
    Sha256::toHex(digest, hex);
    if (std::strcmp(hex, expected) != 0) {
        std::fprintf(stderr, "SHA256 mismatch: %s\n", hex);
        return false;
    }
    return true;
}

int main() {
    if (!check("", 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", 1)) return 1;
    if (!check("abc", 3, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", 1)) return 1;
    const char* multi = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
    if (!check(multi, std::strlen(multi), "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1", 7)) return 1;
    static char million[1000000];
    std::memset(million, 'a', sizeof(million));
    if (!check(million, sizeof(million), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0", 508)) return 1;
    std::puts("SHA256 host tests passed (empty, abc, multi-block, million-byte streamed input)");
    return 0;
}
