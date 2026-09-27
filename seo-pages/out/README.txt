تعليمات الرفع على Firebase Hosting
====================================

1. فك ضغط هذا الملف.
2. انسخ محتوياته (مجلد word، وملفي sitemap.xml وrobots.txt) إلى نفس المجلد
   اللي فيه index.html بتاع الموقع الرئيسي (public folder في مشروع Firebase).
3. ارفع بالأمر المعتاد:
   firebase deploy --only hosting
4. بعد الرفع، تأكد إن الرابط ده بيشتغل:
   https://ghareebalquran.com/sitemap.xml
5. سجّل الموقع في Google Search Console (لو لسه ما عملتهاش):
   https://search.google.com/search-console
   وقدّم رابط الـ sitemap فيها (Sitemaps > أضف sitemap جديد > اكتب sitemap.xml)
   ده اللي بيخلي جوجل يكتشف الصفحات بسرعة بدل ما يستنى يلاقيها لوحده.

ملاحظات:
- كل صفحة كلمة رابطها زي: https://ghareebalquran.com/word/<اسم-الكلمة>.html
- الصفحات كلها HTML ثابت (بدون جافاسكريبت)، فمحتواها هيظهر لجوجل مباشرة.
- الصورة المستخدمة في المعاينة (og-image.png) هي نفس صورة الموقع الرئيسي.
  لو مش موجودة عندك على السيرفر، ضيفها في الجذر (نفس مكان index.html).
