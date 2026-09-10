"""Pinned downloads only. Model data stays outside Git; remote Python code is never enabled."""
from pathlib import Path
import sys,json,os,shutil,hashlib,ssl,urllib.request,zipfile
import certifi
req=json.loads(Path(sys.argv[1]).read_text());root=Path(req['root']);models=Path(req['models']);m=req['model']
os.environ['HF_HOME']=str(models/'.huggingface')
from huggingface_hub import snapshot_download,hf_hub_download
shared=json.loads((root/'config/shared-models.json').read_text())
def download(url,dest,sha=None):
    if dest.exists() and (not sha or hashlib.sha256(dest.read_bytes()).hexdigest()==sha):return
    dest.parent.mkdir(parents=True,exist_ok=True);partial=dest.with_suffix(dest.suffix+'.download')
    print('Загружаем '+dest.name,flush=True)
    with urllib.request.urlopen(url,context=ssl.create_default_context(cafile=certifi.where()),timeout=120) as response,partial.open('wb') as out:
        while chunk:=response.read(1024*1024):out.write(chunk)
    if sha and hashlib.sha256(partial.read_bytes()).hexdigest()!=sha:
        partial.unlink();raise RuntimeError('Контрольная сумма не совпала: '+dest.name)
    partial.replace(dest)
def hf(repo,rev,filename,dest):
    if dest.exists():return
    src=hf_hub_download(repo,filename,revision=rev);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dest)
if m['kind']=='mlx':
    print('Загружаем '+m['name'],flush=True)
    snapshot_download(m['repo'],revision=m['revision'],local_dir=m['path'],allow_patterns=['*.json','*.safetensors','*.jinja','*.txt','*.model','README.md'],max_workers=4)
    Path(m['path'],'studio-source.json').write_text(json.dumps({'repo':m['repo'],'revision':m['revision']}))
else:
    assets=models/'voice';assets.mkdir(parents=True,exist_ok=True)
    download(shared['silero']['url'],assets/'silero-v5-ru.pt',shared['silero']['sha256'])
    import whisper
    download(whisper._MODELS['base'],assets/'whisper/base.pt',whisper._MODELS['base'].split('/')[-2])
    if m['kind']=='rvc':
        vendor=Path(req['voice']['vendor'])
        if not (vendor/'tools/convert_rvc_model.py').exists():raise RuntimeError('Сначала установи движок RVC.')
        dest=Path(m['path']);source=dest.parent/'source.pth'
        if not source.exists():
            fetched=hf_hub_download(m['repo'],m['filename'],revision=m['revision'])
            source.parent.mkdir(parents=True,exist_ok=True)
            if m['filename'].endswith('.zip'):
                with zipfile.ZipFile(fetched) as z:
                    candidates=[x for x in z.infolist() if x.filename.endswith('.pth') and x.file_size<2*1024**3]
                    if len(candidates)!=1:raise RuntimeError('В архиве ожидается один .pth файл.')
                    with z.open(candidates[0]) as src,source.open('wb') as out:shutil.copyfileobj(src,out)
            else:shutil.copyfile(fetched,source)
        sys.path.insert(0,str(vendor));os.chdir(vendor)
        from tools.convert_rvc_model import convert_weights
        if not dest.exists():convert_weights(str(source),str(dest))
        target=vendor/'rvc_mlx/models/embedders/contentvec/hubert_mlx.npz'
        predictor=vendor/'rvc_mlx/models/predictors/rmvpe_mlx.npz'
        if not target.exists() or not predictor.exists():
            if not vendor.resolve().is_relative_to(root.resolve()/'vendor'):raise RuntimeError('Внешний RVC неполный. Установи собственный движок в студию.')
            import torch,mlx.core as mx
            if not target.exists():
                p=assets/'contentvec/pytorch_model.bin';hf(shared['applio']['repo'],shared['applio']['revision'],'Resources/embedders/contentvec/pytorch_model.bin',p)
                hf(shared['applio']['repo'],shared['applio']['revision'],'Resources/embedders/contentvec/config.json',assets/'contentvec/config.json')
                state=torch.load(p,map_location='cpu',weights_only=True);weights={};prefix='encoder.pos_conv_embed.conv.'
                v,g=state[prefix+'weight_v'],state[prefix+'weight_g'];weight=v*(g/torch.linalg.vector_norm(v,dim=(0,1),keepdim=True))
                weights['encoder.pos_conv_embed.weight']=mx.array(weight.numpy().transpose(0,2,1))
                for key,value in state.items():
                    if key=='masked_spec_embed' or key in (prefix+'weight_g',prefix+'weight_v'):continue
                    key=key.replace(prefix,'encoder.pos_conv_embed.');array=value.detach().cpu().numpy()
                    if 'feature_extractor.conv_layers' in key and array.ndim==3:array=array.transpose(0,2,1)
                    weights[key]=mx.array(array)
                target.parent.mkdir(parents=True,exist_ok=True);mx.savez(str(target),**weights)
            if not predictor.exists():
                hf(shared['applio']['repo'],shared['applio']['revision'],'Resources/predictors/rmvpe.pt',vendor/'rvc/models/predictors/rmvpe.pt')
                from tools.convert_rmvpe import convert
                convert()
        dest.with_name('studio-source.json').write_text(json.dumps({'repo':m['repo'],'revision':m['revision'],'filename':m['filename']}))
print('Модель готова.',flush=True)
