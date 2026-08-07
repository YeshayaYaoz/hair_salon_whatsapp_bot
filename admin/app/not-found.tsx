import Link from "next/link";
import Image from "next/image";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#F4F6F8] flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <Image src="/tori_logo_transparent.png" alt="תורי" width={56} height={56} className="mx-auto mb-6 rounded-2xl" />
        <div className="text-6xl font-extrabold text-[#197492] tracking-tight mb-2">404</div>
        <h1 className="text-lg font-bold text-gray-900 mb-2">הדף לא נמצא</h1>
        <p className="text-sm text-gray-500 mb-8 leading-relaxed">
          נראה שהקישור שגוי או שהדף הוזז. בוא נחזיר אותך למקום בטוח.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 bg-[#1B7FA0] hover:bg-[#2A9BBF] text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition"
        >
          חזרה לדף הבית
        </Link>
      </div>
    </div>
  );
}
