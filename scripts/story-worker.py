import os, sys, json, traceback
from pathlib import Path
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TOKENIZERS_PARALLELISM']='false'
PROTOCOL=sys.stdout
sys.stdout=sys.stderr
import mlx.core as mx
from mlx_lm import load, stream_generate
from mlx_lm.sample_utils import make_sampler
root=Path(__file__).resolve().parent.parent
model=None
tokenizer=None
model_path=None
def emit(x):
    PROTOCOL.write(json.dumps(x,ensure_ascii=False)+'\n');PROTOCOL.flush()
for line in sys.stdin:
    req={}
    try:
        req=json.loads(line)
        if model is None or model_path!=req['model_path']:
            emit({'id':req['id'],'stage':'Загружаем Qwen в память…'})
            model=None;tokenizer=None
            mx.clear_cache()
            model,tokenizer=load(req['model_path'],tokenizer_config={'trust_remote_code':False})
            model_path=req['model_path']
        mx.random.seed(req['seed'])
        prompt=tokenizer.apply_chat_template(req['messages'], tokenize=False, add_generation_prompt=True, enable_thinking=False)
        emit({'id':req['id'],'stage':'Пишем сцену за сценой…'})
        out=[]
        for i,response in enumerate(stream_generate(model,tokenizer,prompt=prompt,max_tokens=req.get('max_tokens',2600),sampler=make_sampler(temp=req.get('temperature',.85),top_p=.9))):
            out.append(response.text)
            if i%80==0:emit({'id':req['id'],'stage':f'Пишем историю · {i+1} токенов'})
        emit({'id':req['id'],'result':''.join(out)})
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        emit({'id':req.get('id'),'error':str(e)})
