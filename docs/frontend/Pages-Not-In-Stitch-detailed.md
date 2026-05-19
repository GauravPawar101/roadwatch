# Pages Not In Stitch — Detailed

Format: `filePath` -> [ComponentName(data-structure, position on page)]

- `frontend/src/pages/AgentChat.tsx` -> [Container({maxWidth:string}, header), Card/CardBody(), ChatArea(messages:{from:string,text:string}[], position: main), MessageList(messages, position: main), Input(value:string,onChange, position: form), Button(send, position: form)]

- `frontend/src/pages/BudgetHistory.tsx` -> [Hero({title:string,subtitle:string}, position: header), StatsGrid(StatCard[] -> {value:string,label:string,icon:string}, position: summary), Alert({variant, title, children}, position: summary), Section({title}, position: main), TimelineEntry({date:string,type:string,amount:string,source:string,anomaly?:boolean}, position: timeline list), Card/CardBody(entry), Badge(variant,label, position: entry)]

- `frontend/src/pages/Escalation.tsx` -> [Card/CardBody(), SummaryFields({currentAuthority:string,nextEscalation:string,reason:string}, position: main), Actions({confirmEscalation():void,cancel():void}, position: actions)]

- `frontend/src/pages/auth/ContractorSignup.tsx` -> [Card/CardBody(), Notice(message:string, position: centered)]

- `frontend/src/pages/auth/ContractorLogin.tsx` -> [Card/CardBody(), Form(formState:{identifier:string,password:string,loading:boolean,error?:string}, position: centered), FormGroup/Input(name,type,value,onChange), Button(submit, loading), Alert(error), DecorativeBackground(elements, position: background)]

- `frontend/src/pages/auth/CitizenSignup.tsx` -> [Card/CardBody(), Form(formData:{email?:string,phone?:string,username?:string,name?:string,password:string,confirmPassword:string}, validation:{passwordErrors:string[]}, position: centered), FormGroup/Input, Button(submit), Alert(error)]

- `frontend/src/pages/auth/CitizenLogin.tsx` -> [Card/CardBody(), Form(formState:{identifier:string,password:string,loading:boolean,error?:string}, position: centered), FormGroup/Input, Button(submit), Alert(error), DecorativeBackground(elements)]

- `frontend/src/pages/auth/AuthoritySignup.tsx` -> [Card/CardBody(), Form(formData:{email:string,username:string,password:string,confirmPassword:string,phone?:string,fabricCertPem:string,fabricMspId:string,fabricOrgName?:string}, validation:{passwordErrors:string[]}, position: centered), Alert(warning: string, position: top)]

- `frontend/src/pages/auth/AuthorityLogin.tsx` -> [Card/CardBody(), Form(formState:{identifier:string,password:string,loading:boolean,error?:string,roleHint?:string}, position: centered), FormGroup/Input, Button(submit), Alert(error), DecorativeBackground(elements)]

---
Notes:
- These entries represent the runtime components and primary data shapes the pages consume or render.
- If you want these exported as Stitch-ready stubs, I can generate minimal TSX files that expose the components and mock data matching these shapes.
