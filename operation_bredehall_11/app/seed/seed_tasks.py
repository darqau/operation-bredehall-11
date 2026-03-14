"""Fyller databasen med standarduppgifter för svensk villa (körs vid första start om tom)."""
from datetime import date, timedelta

from app.database import SessionLocal, init_db
from app.models import Base, Task
from app.database import engine


def seed_if_empty() -> None:
    """Kör seed endast om tabellen tasks är tom."""
    init_db()
    from sqlalchemy import text
    with engine.connect() as conn:
        r = conn.execute(text("SELECT COUNT(*) FROM tasks"))
        count = r.scalar() or 0
    if count and count > 0:
        return
    today = date.today()
    db = SessionLocal()
    try:
        tasks = [
            # Hus/Trädgård
            Task(
                title="Rensa hängrännor",
                category="Hus",
                frequency="Årlig",
                last_done=today - timedelta(days=200),
                next_deadline=today + timedelta(days=165),
                reason="Förhindra vattenläckage och skador på fasaden.",
                description="Rensa löv och skräp från rännor och nedfallsrör. Kontrollera fästen.",
            ),
            Task(
                title="Olja/tvätta altanen",
                category="Trädgård",
                frequency="Årlig",
                last_done=today - timedelta(days=400),
                next_deadline=today + timedelta(days=60),
                reason="Skydda träet och förlänga livslängden.",
                description="Tvätta med altanrengöring, låt torka, applicera olja eller impregnering.",
            ),
            Task(
                title="Kontrollera/byta filter på värmepumpen",
                category="Värme",
                frequency="Månatlig",
                last_done=today - timedelta(days=45),
                next_deadline=today + timedelta(days=25),
                reason="Bra luftkvalitet och effektiv drift.",
                description="Rensa eller byt luftfilter enligt tillverkarens anvisning.",
            ),
            Task(
                title="Tvätta fasaden",
                category="Hus",
                frequency="Vart 3:e år",
                last_done=today - timedelta(days=800),
                next_deadline=today + timedelta(days=300),
                reason="Ta bort mossa och smuts, skydda fasadmaterial.",
                description="Använd tryckluft eller mjuk borste. Undvik för högt tryck på murbruk.",
            ),
            Task(
                title="Rensa golvbrunnar",
                category="Hus",
                frequency="Kvartalsvis",
                last_done=today - timedelta(days=50),
                next_deadline=today + timedelta(days=40),
                reason="Undvik vattenansamling och lukt.",
                description="Lyft lock, rensa blad och slam. Kontrollera att vattnet rinner.",
            ),
            Task(
                title="Kontrollera vind/krypgrund",
                category="Hus",
                frequency="Årlig",
                last_done=today - timedelta(days=180),
                next_deadline=today + timedelta(days=185),
                reason="Upptäck fukt, skadedjur och skador i tid.",
                description="Sök efter fukt, mögel, gnagare. Kontrollera ventilation.",
            ),
            # Ekonomi/Admin
            Task(
                title="Årlig inkomstdeklaration (maj)",
                category="Ekonomi",
                frequency="Årlig",
                last_done=date(today.year - 1, 5, 15),
                next_deadline=date(today.year, 5, 2),
                reason="Skatteverkets deadline för e-deklaration.",
                description="Samla intäkts- och avdragsunderlag. Lämna via e-tjänst.",
            ),
            Task(
                title="Omförhandling bolåneräntor",
                category="Ekonomi",
                frequency="Årlig",
                last_done=today - timedelta(days=370),
                next_deadline=today + timedelta(days=30),
                reason="Säkra rimlig ränta när bindningstid löper ut.",
                description="Jämför erbjudanden från nuvarande och andra banker.",
            ),
            Task(
                title="Årlig genomgång elavtal och hemförsäkring",
                category="Administration",
                frequency="Årlig",
                last_done=today - timedelta(days=350),
                next_deadline=today + timedelta(days=50),
                reason="Hitta bättre pris och täckning.",
                description="Elavtal: jämför elpriser. Försäkring: kontrollera täckning och premie.",
            ),
            Task(
                title="Planering av buffertsparande",
                category="Ekonomi",
                frequency="Årlig",
                last_done=today - timedelta(days=200),
                next_deadline=today + timedelta(days=165),
                reason="Säkerställ sparande för oförutsedda utgifter.",
                description="Budgetera månadssparande. Överväg sparkonto eller fond.",
            ),
        ]
        for t in tasks:
            t.created_at = today
            t.updated_at = today
            db.add(t)
        db.commit()
    finally:
        db.close()
