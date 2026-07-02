import argparse
import datetime as dt
import json
import struct
from pathlib import Path


def read_uint32(data, offset):
    return struct.unpack_from("<I", data, offset)[0]


def read_uint16(data, offset):
    return struct.unpack_from("<H", data, offset)[0]


class OleFile:
    def __init__(self, path):
        self.data = Path(path).read_bytes()
        if self.data[:8] != b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
            raise ValueError("Not an OLE compound file")
        self.sector_shift = read_uint16(self.data, 30)
        self.mini_sector_shift = read_uint16(self.data, 32)
        self.sector_size = 1 << self.sector_shift
        self.mini_sector_size = 1 << self.mini_sector_shift
        self.num_fat = read_uint32(self.data, 44)
        self.first_dir_sector = read_uint32(self.data, 48)
        self.mini_cutoff = read_uint32(self.data, 56)
        self.first_mini_fat_sector = read_uint32(self.data, 60)
        self.num_mini_fat = read_uint32(self.data, 64)
        difat = [read_uint32(self.data, 76 + i * 4) for i in range(109)]
        self.fat = []
        for sector in difat:
            if sector in (0xFFFFFFFF, 0xFFFFFFFE):
                continue
            sec = self.sector(sector)
            self.fat.extend(struct.unpack("<" + "I" * (self.sector_size // 4), sec))
        self.directory = self.read_directory()
        root = self.directory[0]
        self.mini_stream = self.read_stream_by_entry(root, force_fat=True) if root["start"] != 0xFFFFFFFF else b""
        self.mini_fat = []
        if self.first_mini_fat_sector != 0xFFFFFFFF:
            for sector in self.chain(self.first_mini_fat_sector):
                sec = self.sector(sector)
                self.mini_fat.extend(struct.unpack("<" + "I" * (self.sector_size // 4), sec))

    def sector(self, sid):
        start = (sid + 1) * self.sector_size
        return self.data[start:start + self.sector_size]

    def chain(self, start):
        sid = start
        seen = set()
        while sid not in (0xFFFFFFFE, 0xFFFFFFFF) and sid not in seen:
            seen.add(sid)
            yield sid
            sid = self.fat[sid]

    def read_directory(self):
        raw = b"".join(self.sector(sid) for sid in self.chain(self.first_dir_sector))
        entries = []
        for offset in range(0, len(raw), 128):
            entry = raw[offset:offset + 128]
            if len(entry) < 128:
                continue
            name_len = read_uint16(entry, 64)
            name = entry[:max(0, name_len - 2)].decode("utf-16le", errors="ignore")
            entries.append({
                "name": name,
                "type": entry[66],
                "start": read_uint32(entry, 116),
                "size": read_uint32(entry, 120),
            })
        return entries

    def read_stream_by_entry(self, entry, force_fat=False):
        if not force_fat and entry["size"] < self.mini_cutoff and self.mini_stream:
            chunks = []
            sid = entry["start"]
            seen = set()
            while sid not in (0xFFFFFFFE, 0xFFFFFFFF) and sid not in seen:
                seen.add(sid)
                start = sid * self.mini_sector_size
                chunks.append(self.mini_stream[start:start + self.mini_sector_size])
                sid = self.mini_fat[sid]
            return b"".join(chunks)[:entry["size"]]
        return b"".join(self.sector(sid) for sid in self.chain(entry["start"]))[:entry["size"]]

    def read_stream(self, name):
        wanted = name.lower()
        for entry in self.directory:
            if entry["name"].lower() == wanted:
                return self.read_stream_by_entry(entry)
        raise KeyError(name)


def read_unicode_string(data, offset):
    length = read_uint16(data, offset)
    flags = data[offset + 2]
    offset += 3
    rich_runs = 0
    ext_size = 0
    if flags & 0x08:
        rich_runs = read_uint16(data, offset)
        offset += 2
    if flags & 0x04:
        ext_size = read_uint32(data, offset)
        offset += 4
    if flags & 0x01:
        raw = data[offset:offset + length * 2]
        text = raw.decode("utf-16le", errors="ignore")
        offset += length * 2
    else:
        raw = data[offset:offset + length]
        text = raw.decode("latin1", errors="ignore")
        offset += length
    offset += rich_runs * 4 + ext_size
    return text, offset


def decode_rk(raw):
    mult100 = raw & 0x01
    is_int = raw & 0x02
    value_bits = raw & 0xFFFFFFFC
    if is_int:
        if value_bits & 0x80000000:
            value_bits -= 0x100000000
        value = value_bits >> 2
    else:
        packed = struct.pack("<Q", value_bits << 32)
        value = struct.unpack("<d", packed)[0]
    return value / 100 if mult100 else value


def excel_number_to_date(value):
    if not isinstance(value, (int, float)):
        return value
    if 20000 <= value <= 60000:
        base = dt.datetime(1899, 12, 30)
        return (base + dt.timedelta(days=float(value))).strftime("%Y-%m-%d")
    if 0 <= value < 1:
        total = round(value * 24 * 60)
        hour = total // 60
        minute = total % 60
        suffix = "AM" if hour < 12 else "PM"
        display = hour % 12 or 12
        return f"{display}:{minute:02d} {suffix}"
    return value


def parse_biff(workbook):
    records = []
    pos = 0
    while pos + 4 <= len(workbook):
        rid, size = struct.unpack_from("<HH", workbook, pos)
        pos += 4
        payload = workbook[pos:pos + size]
        pos += size
        records.append((rid, payload))
    sst = []
    cells = {}
    sheet_index = -1
    for rid, payload in records:
        if rid == 0x0809 and len(payload) >= 4:
            bof_type = read_uint16(payload, 2)
            if bof_type == 0x0010:
                sheet_index += 1
        elif rid == 0x00FC:
            offset = 8
            while offset < len(payload):
                try:
                    text, offset = read_unicode_string(payload, offset)
                except Exception:
                    break
                sst.append(text)
        elif sheet_index >= 0 and rid == 0x00FD and len(payload) >= 10:
            row, col = read_uint16(payload, 0), read_uint16(payload, 2)
            idx = read_uint32(payload, 6)
            cells[(sheet_index, row, col)] = sst[idx] if idx < len(sst) else ""
        elif sheet_index >= 0 and rid == 0x0203 and len(payload) >= 14:
            row, col = read_uint16(payload, 0), read_uint16(payload, 2)
            value = struct.unpack_from("<d", payload, 6)[0]
            cells[(sheet_index, row, col)] = excel_number_to_date(value)
        elif sheet_index >= 0 and rid == 0x027E and len(payload) >= 10:
            row, col = read_uint16(payload, 0), read_uint16(payload, 2)
            cells[(sheet_index, row, col)] = excel_number_to_date(decode_rk(read_uint32(payload, 6)))
        elif sheet_index >= 0 and rid == 0x00BD and len(payload) >= 6:
            row, first_col = read_uint16(payload, 0), read_uint16(payload, 2)
            last_col = read_uint16(payload, 4)
            offset = 6
            for col in range(first_col, last_col + 1):
                if offset + 6 > len(payload):
                    break
                rk = read_uint32(payload, offset + 2)
                cells[(sheet_index, row, col)] = excel_number_to_date(decode_rk(rk))
                offset += 6
        elif sheet_index >= 0 and rid == 0x0204 and len(payload) >= 8:
            row, col = read_uint16(payload, 0), read_uint16(payload, 2)
            length = read_uint16(payload, 6)
            text = payload[8:8 + length].decode("latin1", errors="ignore")
            cells[(sheet_index, row, col)] = text
    return cells


def cells_to_rows(cells, sheet=0):
    coords = [(r, c) for (s, r, c) in cells if s == sheet]
    if not coords:
        return []
    max_row = max(r for r, _ in coords)
    max_col = max(c for _, c in coords)
    rows = []
    for r in range(max_row + 1):
        rows.append([cells.get((sheet, r, c), "") for c in range(max_col + 1)])
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("path")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    ole = OleFile(args.path)
    workbook = ole.read_stream("Workbook")
    rows = cells_to_rows(parse_biff(workbook), 0)
    if args.limit:
        rows = rows[:args.limit]
    if args.json:
        print(json.dumps(rows, ensure_ascii=False))
    else:
        for row in rows:
            print("\t".join(str(v) for v in row))


if __name__ == "__main__":
    main()
