# Analiza tramos de audio generados por VOZI: tono, silencios, cortes y transcripción automática.
import wave, numpy as np, json, subprocess, os, sys
sys.path.insert(0, '/home/claude/bench')
from eval_lib import f0
M='/home/claude/models'; B=M+'/sherpa-onnx-v1.13.8-linux-x64-shared'; W=M+'/sherpa-onnx-whisper-small'
def load(p):
    w=wave.open(p); sr=w.getframerate(); x=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float32)/32768; return x,sr
for n in sys.argv[1:]:
    x,sr=load(n+'.wav'); m,a,b=f0(x,sr)
    hop=int(0.01*sr); e=np.array([np.sqrt(np.mean(x[i:i+hop]**2)) for i in range(0,len(x)-hop,hop)])
    sil=e<0.003; runs=[]; r=0
    for s in sil:
        if s: r+=1
        else:
            if r: runs.append(r*0.01)
            r=0
    print(f'{n}: {len(x)/sr:.1f}s sr={sr} F0 mediana={m:.0f} Hz | silencios >0,15 s: {len([v for v in runs if v>0.15])}, silencio máx={max(runs):.2f} s, saturación={np.mean(np.abs(x)>0.99)*100:.3f}%')
    if os.path.exists(n+'.json'):
        t=json.load(open(n+'.json')); gaps=[round(t[i+1]['t0']-t[i]['t1'],2) for i in range(len(t)-1)]
        print('  pausas programadas entre piezas (s):', gaps)
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',n+'.wav','-ar','16000',n+'-16k.wav'])
    r=subprocess.run([B+'/bin/sherpa-onnx-offline','--num-threads=2',f'--whisper-encoder={W}/small-encoder.int8.onnx',f'--whisper-decoder={W}/small-decoder.int8.onnx',f'--tokens={W}/small-tokens.txt','--whisper-language=es',n+'-16k.wav'],capture_output=True,text=True,env=dict(os.environ,LD_LIBRARY_PATH=B+'/lib'))
    js=[json.loads(l)['text'] for l in (r.stdout+r.stderr).splitlines() if l.startswith('{')]
    print('  transcripción automática:', js[0] if js else r.stderr[-300:])
