import numpy as np
from PIL import Image
N=480
Y,X=np.mgrid[0:N,0:N]/(N-1)
def ss(a,b,v):
    t=np.clip((v-a)/(b-a),0,1);return t*t*(3-2*t)
def blob(cx,cy,rx,ry,soft=.8):
    d=np.sqrt(((X-cx)/rx)**2+((Y-cy)/ry)**2);return 1-ss(1-soft,1.0,d)
def hx(h): return np.array([int(h[i:i+2],16) for i in (1,3,5)],float)
def mixh(a,b,p): return a*(1-p)+b*p
def lay(img,col,a): return img*(1-a[...,None])+col*a[...,None]
W=np.array([255,255,255.])
CORES=[(.50,-.02,.46,.36),(.22,.04,.40,.34),(.78,.04,.40,.34),(.50,.16,.66,.19),(.50,.10,.30,.30),(.34,.20,.36,.28)]
def tile(i,t,u,s,seed=0,night=True):
    t,u,s=hx(t),hx(u),hx(s)
    D=s if night else mixh(t,hx('#14211b'),.6)
    cx,cy,rx,ry=CORES[i]
    img=np.ones((N,N,3))*mixh(t,W,.12)
    img=lay(img,mixh(t,s,.35),ss(.1,.75,Y)*.6)
    img=lay(img,u,blob(1-cx if cx!=.5 else .5,.92,.7,.5,.95)*.28)
    img=lay(img,mixh(t,W,.38),blob(1-cx if cx!=.5 else .5,.42,.34,.2,.95)*.4)
    img=lay(img,D,blob(cx,cy,rx,ry,.9)*.95)
    img=lay(img,s,ss(.42,.94,Y)**1.15)
    e=np.minimum(np.minimum(X,1-X),Y)
    img=lay(img,W,(1-ss(0,.04,e))*.28*(1-ss(.5,.8,Y)))
    rng=np.random.default_rng(seed);img=img+rng.uniform(-1.2,1.2,img.shape)
    return np.clip(img,0,255).astype(np.uint8)
def mx(a,b,p): return '#%02x%02x%02x'%tuple(int(round(int(a[k:k+2],16)*(1-p)+int(b[k:k+2],16)*p)) for k in (1,3,5))
PAL={'def':[['#F2F0E8','#1E6B50','#8FCBAE','#EBC98A'],['#0A0E1F','#9FB4FF','#4B5BDB','#2FB5A8']],'lav':[['#F1F0F8','#4B3CD8','#B9B4FF','#8FA8FF'],['#0B0D22','#B7B2FF','#5B6CF0','#C6B8FF']],'sun':[['#F6EFEA','#A8381F','#F2A97B','#E8B5D6'],['#140A1C','#FFB38A','#E0689B','#F2A97B']],'neo':[['#EEF3F6','#0B6E8A','#7FD6EA','#F0A6D0'],['#0B0620','#7FE7FF','#19C2E8','#E64AA8']],'min':[['#F1F3E8','#1E6B50','#A5E3C4','#F2E28A'],['#08140F','#A6F0C6','#3FBF8F','#E8D56A']]}
def colors(k,night):
    c=PAL[k][1 if night else 0]
    s=mx(c[0],'#ffffff',.07) if night else mx(c[0],'#ffffff',.55)
    return c[2],c[3],s,c[0]
if __name__=='__main__':
    rows=[]
    for k in ['def','sun']:
        for night in (True,False):
            t,u,s,bg=colors(k,night)
            row=[tile(i,t,u,s,i,night) for i in range(6)]
            pad=np.ones((N,12,3),np.uint8)*np.array([int(bg[j:j+2],16) for j in (1,3,5)],np.uint8)
            rows.append(np.concatenate(sum([[r,pad] for r in row],[]),axis=1))
    sheet=np.concatenate(rows,axis=0);Image.fromarray(sheet).resize((sheet.shape[1]//3,sheet.shape[0]//3),Image.LANCZOS).save('sheet.png')
