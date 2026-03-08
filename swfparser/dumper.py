import struct, io, zlib
as_tags = {0:'End', 
 1:'ShowFrame', 
 2:'DefineShape', 
 4:'PlaceObject', 
 5:'RemoveObject', 
 6:'DefineBits', 
 7:'DefineButton', 
 8:'JPEGTables', 
 9:'SetBackgroundColor', 
 10:'DefineFont', 
 11:'DefineText', 
 12:'DoAction', 
 13:'DefineFontInfo', 
 14:'DefineSound', 
 15:'StartSound', 
 17:'DefineButtonSound', 
 18:'SoundStreamHead', 
 19:'SoundStreamBlock', 
 20:'DefineBitsLossless', 
 21:'DefineBitsJPEG2', 
 22:'DefineShape2', 
 23:'DefineButtonCxform', 
 24:'Protect', 
 26:'PlaceObject2', 
 28:'RemoveObject2', 
 32:'DefineShape3', 
 33:'DefineText2', 
 34:'DefineButton2', 
 35:'DefineBitsJPEG3', 
 36:'DefineBitsLossless2', 
 37:'DefineEditText', 
 39:'DefineSprite', 
 43:'FrameLabel', 
 45:'SoundStreamHead2', 
 46:'DefineMorphShape', 
 48:'DefineFont2', 
 56:'ExportAssets', 
 57:'ImportAssets', 
 58:'EnableDebugger', 
 59:'DoInitAction', 
 60:'DefineVideoStream', 
 61:'VideoFrame', 
 62:'DefineFontInfo2', 
 64:'EnableDebugger2', 
 65:'ScriptLimits', 
 66:'SetTabIndex', 
 69:'FileAttributes', 
 70:'PlaceObject3', 
 71:'ImportAssets2', 
 73:'DefineFontAlignZones', 
 74:'CSMTextSettings', 
 75:'DefineFont3', 
 76:'SymbolClass', 
 77:'Metadata', 
 78:'DefineScalingGrid', 
 82:'DoABC', 
 83:'DefineShape4', 
 84:'DefineMorphShape2', 
 86:'DefineSceneAndFrameLabelData', 
 87:'DefineBinaryData', 
 88:'DefineFontName', 
 89:'StartSound2', 
 90:'DefineBitsJPEG4', 
 91:'DefineFont4'}

def get_byte(src):
    return struct.unpack('<B', src.read(1))[0]


def get_short(src):
    return struct.unpack('<H', src.read(2))[0]


def get_int(src):
    return struct.unpack('<I', src.read(4))[0]


class Stream:

    def __init__(self, src):
        self.src = src
        self.bits = None
        self.count = 0

    def get_bin(self, quant):
        if not quant:
            return
        else:
            _bin = []
            while quant:
                if quant:
                    if self.count == 0:
                        a = self.src.read(1)
                        b = struct.unpack('<B', a)[0]
                        self.bits = bin(b)[2:].zfill(8)
                        self.count = 8
                        continue
                    elif quant > self.count:
                        quant -= self.count
                        n, self.count = self.count, 0
                    else:
                        self.count -= quant
                        n, quant = quant, 0
                    _bin.append(self.bits[:n])
                    self.bits = self.bits[n:]

        return int(''.join(_bin), 2)

    def calc_bin(self, quant):
        if quant < 2:
            return self.get_bin(quant)
        a, b = self.get_bin(1), self.get_bin(quant - 1)
        if a == 0:
            return b
        c = 2 ** (quant - 1) - 1
        return -1 * ((b ^ c) + 1)


class Swf:

    def __init__(self):
        self.buf = None
        self.header = {'Version':0, 
         'Sign':0}
        self.tags = {}
        self.frame_count = 0
        self.frame_rate = 0
        self.frame_size = 0

    def read(self, file):
        self.buf = open(file, 'rb')
        self.get_header()
        self.get_tags()

    def get_rect_struct(self):
        a = Stream(self.buf)
        _bin = a.get_bin(5)
        return tuple((a.calc_bin(_bin) for _ in range(4)))

    def get_header(self):
        sig = ''.join((chr(get_byte(self.buf)) for _ in range(3)))
        self.header['Sign'] = sig
        self.header['Version'] = get_byte(self.buf)
        _int = get_int(self.buf)
        if sig[0] == 'C':
            unzip = zlib.decompress(self.buf.read())
            if len(unzip) + 8 != _int:
                raise ValueError('Invalid compressed content')
            self.buf = io.BytesIO(unzip)
        self.frame_size = self.get_rect_struct()
        self.frame_rate, self.frame_count = get_short(self.buf), get_short(self.buf)

    def get_tags(self):
        a = 0
        while True:
            b = get_short(self.buf)
            c = b >> 6
            if c == 0:
                break
            d = b & 63
            if d == 63:
                d = get_int(self.buf)
            e = self.buf.read(d)
            if c in as_tags.keys():
                self.tags[a] = [
                 as_tags[c], e]
            a += 1
