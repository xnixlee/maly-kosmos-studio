"""Local Silero → character RVC → word alignment. JSON-lines IPC on stdout."""
from pathlib import Path
import os,sys,json,re,time,traceback,hashlib,shutil,faulthandler,gc
faulthandler.enable()
ROOT=Path(os.environ['VOICE_ASSETS_ROOT']).resolve()
VENDOR=Path(os.environ['VOICE_VENDOR']).resolve()
OUTPUT=Path(os.environ['STUDIO_OUTPUT']).resolve()
os.environ.setdefault('OMP_NUM_THREADS','4')
os.environ.setdefault('NUMBA_CACHE_DIR',str(ROOT/'.cache/numba'))
os.environ.setdefault('MPLCONFIGDIR',str(ROOT/'.cache/matplotlib'))
os.environ['HF_HUB_OFFLINE']='1'
PROTOCOL=sys.stdout
sys.stdout=sys.stderr
import numpy as np
import torch
import soundfile as sf
import librosa
torch.set_num_threads(4)
tts=None
converter=None
converter_voice=None
CHARACTERS={}
aligner=None
SR=48000

def emit(value):
    PROTOCOL.write(json.dumps(value,ensure_ascii=False)+'\n');PROTOCOL.flush()

def clean_audio(audio):
    audio=np.asarray(audio,dtype=np.float32)
    if not np.isfinite(audio).all() or np.max(np.abs(audio))<.0001:raise RuntimeError('Модель вернула пустой звук.')
    # Trim the model's leading/trailing padding before assembling the timing.
    active=np.where(np.abs(audio)>.004)[0]
    if len(active):audio=audio[max(0,active[0]-480):min(len(audio),active[-1]+960)]
    return audio

def get_tts():
    global tts
    if tts is None:
        tts=torch.package.PackageImporter(str(ROOT/'silero-v5-ru.pt')).load_pickle('tts_models','model')
        tts.to(torch.device('cpu'))
    return tts

def get_converter(voice):
    global converter,converter_voice
    if converter is None or converter_voice!=voice:
        # Keep only one character model resident on a 16 GB Mac.
        converter=None;gc.collect()
        import mlx.core as mx
        if hasattr(mx,"clear_cache"):mx.clear_cache()
        vendor=VENDOR
        sys.path.insert(0,str(vendor));os.chdir(vendor)
        from rvc_mlx.infer.infer_mlx import RVC_MLX
        converter=RVC_MLX(CHARACTERS[voice]['modelPath'])
        converter_voice=voice
    return converter

def get_aligner():
    global aligner
    if aligner is None:
        import stable_whisper
        aligner=stable_whisper.load_model(str(ROOT/'whisper/base.pt'),device='cpu')
    return aligner

def align_words(audio,text):
    result=get_aligner().align(librosa.resample(audio,orig_sr=SR,target_sr=16000),text,language='ru',verbose=None,regroup=False,fast_mode=True,suppress_silence=False,word_dur_factor=None,max_word_dur=None,vad=False)
    if result is None:raise RuntimeError('Не удалось синхронизировать слова с озвучкой.')
    aligned=[w for segment in result.segments for w in segment.words]
    # Map Whisper token grouping onto original whitespace-delimited words.
    # This retains exact input spelling/punctuation and never inserts a transcription.
    original=text.split()
    norm=lambda value:re.sub(r'\W','',value,flags=re.UNICODE).lower().replace('ё','е')
    out=[];j=0
    for word in original:
        target=norm(word);seen='';start=None;end=None
        while j<len(aligned) and (not seen or len(seen)<len(target)):
            w=aligned[j];j+=1
            start=w.start if start is None else start;end=w.end;seen+=norm(w.word)
        if start is None or seen!=target:raise RuntimeError('Не удалось точно сопоставить слова. Попробуй убрать нестандартные символы.')
        out.append({'word':word,'start':round(max(0,start),3),'end':round(end,3)})
    return out

def generate(req,stage):
    text=req['text'].strip();voice=req.get('voice','spongebob');punch=req.get('punch',True)
    if not text or len(text)>300:raise ValueError('Нужно от 1 до 300 символов.')
    profile=req['profile']
    if profile['kind']=='rvc':CHARACTERS[voice]={'label':profile['name'],'pitch':profile.get('pitch',0),'speaker':profile.get('speaker','eugene'),'modelPath':profile['path']}
    elif profile['kind']!='silero':raise ValueError('Неизвестный тип голоса.')
    settings=req.get('settings',{})
    speed=float(settings.get('speed',1));pitch=float(settings.get('pitch',0));pause=float(settings.get('pause',.3));hold=float(settings.get('hold',.85))
    if not (.7<=speed<=1.4 and -6<=pitch<=6 and 0<=pause<=1.5 and .3<=hold<=3):raise ValueError('Настройки звука вне диапазона.')
    words=text.split();manual_start=settings.get('punchStart')
    if manual_start is not None and (type(manual_start) is not int or not 0<=manual_start<len(words)):raise ValueError('Выбранное слово панчлайна отсутствует во фразе.')
    directory=Path(req['directory']).resolve()
    if not directory.is_relative_to(OUTPUT):raise ValueError('Неверная папка результата.')
    directory.mkdir(parents=True,exist_ok=True)
    digest=hashlib.sha256(json.dumps([text,voice,punch,speed,pitch,pause,hold,manual_start,'studio-neural-v5',profile,str(ROOT),str(VENDOR)],ensure_ascii=False).encode()).hexdigest()
    cache=OUTPUT/'neural-cache'/digest
    if (cache/'result.json').exists():
        shutil.copy2(cache/'voice.wav',directory/'voice.wav')
        return json.loads((cache/'result.json').read_text())
    cut=manual_start if manual_start is not None else (len(words)-(3 if len(words)>8 else 2) if len(words)>3 else None)
    cut=cut if punch else None
    parts=[' '.join(words[:cut]),' '.join(words[cut:])] if cut is not None and cut>0 else [text]
    speaker=CHARACTERS[voice]['speaker'] if voice in CHARACTERS else profile.get('speaker','eugene')
    stage('Нейроозвучка…')
    model=get_tts();pieces=[np.zeros(int(.35*SR),np.float32)];clock=.35;punch_start=None;segments=[]
    for index,part in enumerate(parts):
        with torch.inference_mode():
            audio=model.apply_tts(text=part,speaker=speaker,sample_rate=SR,put_accent=True,put_yo=True)
        audio=clean_audio(audio.numpy())
        if speed!=1:audio=librosa.effects.time_stretch(audio,rate=speed)
        if pitch and voice not in CHARACTERS:audio=librosa.effects.pitch_shift(audio,sr=SR,n_steps=pitch)
        if index or cut==0:pieces.append(np.zeros(int(pause*SR),np.float32));clock+=pause;punch_start=clock
        segments.append((part,clock,audio))
        pieces.append(audio);clock+=len(audio)/SR
    pieces.append(np.zeros(int(hold*SR),np.float32))
    base=np.concatenate(pieces);base/=max(1,np.max(np.abs(base))/.78)
    sf.write(directory/'base.wav',base,SR)
    final=base
    if voice in CHARACTERS:
        stage(CHARACTERS[voice]['label']+' примеряет голос…')
        rvc=get_converter(voice)
        # Direct model inference avoids FAISS/OpenMP crashes on Apple Silicon.
        rvc.infer(str(directory/'base.wav'),str(directory/'converted.wav'),pitch=CHARACTERS[voice]['pitch']+pitch,f0_method='rmvpe',index_path=None,index_rate=0,volume_envelope=.3,protect=.33)
        converted,sample_rate=sf.read(directory/'converted.wav',dtype='float32')
        final=librosa.resample(converted,orig_sr=sample_rate,target_sr=SR)
        if abs(len(final)-len(base))>SR*.15:raise RuntimeError('Преобразование голоса изменило тайминг.')
        final=np.pad(final,(0,max(0,len(base)-len(final))))[:len(base)]
        if not np.isfinite(final).all() or np.max(np.abs(final))<.0001:raise RuntimeError('Модель персонажа вернула пустой звук.')
        final*=min(3,.82/max(.01,np.max(np.abs(final))))
    stage('Синхронизируем каждое слово…')
    # Align the full clean sentence for context. RVC preserves its timing.
    # Known synthesis boundaries prevent the alignment from swallowing the pause.
    timings=align_words(base,text)
    position=0
    for part,offset,audio in segments:
        end=offset+len(audio)/SR
        for _ in part.split():
            word=timings[position];position+=1
            word['start']=max(offset,min(end-.01,word['start']))
            word['end']=min(end,max(word['start']+.01,word['end']))
    duration=len(final)/SR
    # Keep boundaries monotonic and never reveal a word before its audio onset.
    for idx,word in enumerate(timings):
        word['start']=max(word['start'],timings[idx-1]['start']+.01 if idx else .35)
        word['end']=min(duration,max(word['start']+.01,word['end']))
    sf.write(directory/'voice.wav',final,SR,subtype='PCM_16')
    data={'duration':duration,'words':timings,'punchAt':punch_start if punch else None,'punchStart':cut,'engine':'Silero v5 + RVC MLX' if voice in CHARACTERS else 'Silero v5'}
    cache.mkdir(parents=True,exist_ok=True);shutil.copy2(directory/'voice.wav',cache/'voice.wav');(cache/'result.json').write_text(json.dumps(data,ensure_ascii=False))
    return data

for line in sys.stdin:
    req=None
    try:
        req=json.loads(line)
        result=generate(req,lambda message:emit({'id':req['id'],'stage':message}))
        emit({'id':req['id'],'result':result})
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        emit({'id':req.get('id') if isinstance(req,dict) else None,'error':str(error)})
