from app.services.finance.csv_parser import parse_bank_csv, parse_swedish_amount


def test_parse_swedish_amount():
    assert parse_swedish_amount("-1 234,56") == -1234.56
    assert parse_swedish_amount("100,00") == 100.0


def test_parse_nordea_csv():
    content = "Bokföringsdag;Belopp;Text;Saldo\n2025-06-01;-50,00;ICA;1000,00\n"
    rows = parse_bank_csv(content)
    assert len(rows) == 1
    assert rows[0]["amount"] == -50.0
    assert rows[0]["description"] == "ICA"
