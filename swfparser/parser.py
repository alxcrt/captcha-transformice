import os, shutil, subprocess, time, requests, re
from dumper import Swf

def find_all(regex, s):
    r = re.compile(regex)
    result = r.findall(s)
    if len(result) > 0:
        return result
    return None

class Parser:
    def __init__(self):
        self.dumpscript_list = []
        self.download_swf = 'tfm_download.swf'
        self.output_swf = 'tfm.swf'

    def run_console(self, var):
        self.dumpscript_list *= 0
        # var2 = subprocess.Popen(['swfdump', '-a', var], shell=False, stdout=(subprocess.PIPE), stderr=(subprocess.STDOUT), stdin=(subprocess.DEVNULL), creationflags=(subprocess.CREATE_NO_WINDOW))
        var2 = subprocess.Popen(['swfdump', '-a', var], shell=False, stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
        if var2 is None:
            raise Exception('Console not identified')
        for var3 in var2.stdout:
            self.dumpscript_list.append(var3.rstrip().decode())

    def decode_hash(self, file, text):
        str1 = self.read_swf(self.download_swf)
        output = {}
        for _txt in find_all(r"(\s+)exports (\d+) as \"(.*?)_(.*?)\"", file):
            _txt1 = int(_txt[1])
            _txt12 = _txt[3]
            output[_txt12] = _txt1
        else:
            byt = find_all('writeBytes({0})'.format('|'.join(output.keys())), text)
            with open(self.output_swf, 'wb') as (file):
                file.write((b'').join([str1[int(output[_gg])] for _gg in byt]))
                file.close()

    def read_swf(self, swfe):
        swf1 = Swf()
        swf1.read(swfe)
        string11 = False
        count = 1
        var = {}
        for var1 in swf1.tags:
            var2 = swf1.tags[var1]
            if 'DefineBinaryData' in var2[0]:
                string11 = True
                var[count] = var2[1][6:]
            if string11:
                count += 1
        return var

    def find_hash(self, var):
        var1 = find_all(r"findproperty <q>\[(private|public)\](NULL|)(.*?)\n(.*?)pushstring \"(.*?)\"", var)
        if var1 is not None:
            return (var1[0][2], var1[0][4])
        return ('', '')

    def find_var_lines(self, var, var1):
        var2 = ''
        for var3, var4 in enumerate(var):
            if 'getlocal_0' in var4:
                var5 = find_all(r"callproperty <q>\[(private|public)\](NULL|)::(.*?), 0 params", var[(var3 + 1)])
                if var5:
                    var2 += var1[var5[0][2]]
        return var2


    def find_crypto_keys(self, var, var1):
        var2 = {}
        for var3, var4 in enumerate(var):
            if '<q>[public]::Object <q>[private]NULL::' in var4:
                var5 = find_all(r"<q>\[public\]::Object <q>\[private\]NULL::(.*?)=\(\)\(0 params, 0 optional\)", var4)
                if var5 is not None:
                    var6 = find_all(r"push(byte|short|int) (-?\d+)$", var[(var3 + 6)])
                    if var6 is not None:
                        var6 = int(var6[0][1])
                        var2[var5[0]] = var1[var6]
        return var2

    def parse_swf(self):
        txt1 = '\n'.join(self.dumpscript_list)
        if len(txt1) > 500000:
            shutil.copyfile(self.output_swf, self.download_swf)
        var, var1 = self.find_hash(txt1)
        if len(var1) < 16:
            raise Exception('Invalid crypto hash')
        var2 = self.find_crypto_keys(self.dumpscript_list, var1)
        if len(var2) < 10:
            raise Exception('Invalid var keys')
        self.decode_hash(txt1, self.find_var_lines(self.dumpscript_list, var2))

    def _download_swf(self):
        file = requests.get('https://www.transformice.com/Transformice.swf', allow_redirects=True)
        with open(self.download_swf, 'wb') as (_file):
            _file.write(file.content)
            _file.close()

    def start(self):
        print('Downloading Transformice SWF...')
        self._download_swf()
        print('Reading SWF...')
        self.run_console(self.download_swf)
        print('Rewriting SWF bytes...')
        self.parse_swf()
Parser().start()
