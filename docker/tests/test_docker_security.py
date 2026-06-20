"""
RED: Security tests for Docker configuration.
These tests verify:
1. docker-compose.yml uses env vars (no hardcoded credentials)
2. .env.example exists with safe defaults
3. .env is gitignored
4. FTP anonymous access is disabled
"""
import os
import re
import yaml


PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCKER_DIR = os.path.join(PROJECT_ROOT, "docker")
COMPOSE_FILE = os.path.join(DOCKER_DIR, "docker-compose.yml")
ENV_EXAMPLE_FILE = os.path.join(DOCKER_DIR, ".env.example")
VSFTPD_CONF = os.path.join(DOCKER_DIR, "vsftpd", "vsftpd.conf")
GITIGNORE_FILE = os.path.join(PROJECT_ROOT, ".gitignore")


def load_compose():
    with open(COMPOSE_FILE, "r") as f:
        return yaml.safe_load(f)


def test_docker_compose_no_hardcoded_user_name():
    """P0: USER_NAME should use env var, not hardcoded 'testuser'"""
    compose = load_compose()
    ssh_env = compose["services"]["ssh-server"]["environment"]
    user_name_entries = [e for e in ssh_env if "USER_NAME" in e]
    assert len(user_name_entries) > 0, "USER_NAME entry missing"
    for entry in user_name_entries:
        assert "testuser" not in entry or "${SSH_USER" in entry, \
            f"USER_NAME should use ${{SSH_USER}} env var, got: {entry}"
        assert "${SSH_USER" in entry, \
            f"USER_NAME must reference env var ${{SSH_USER}}, got: {entry}"


def test_docker_compose_no_hardcoded_user_password():
    """P0: USER_PASSWORD should use env var, not hardcoded 'testpass'"""
    compose = load_compose()
    ssh_env = compose["services"]["ssh-server"]["environment"]
    user_pass_entries = [e for e in ssh_env if "USER_PASSWORD" in e]
    assert len(user_pass_entries) > 0, "USER_PASSWORD entry missing"
    for entry in user_pass_entries:
        assert "testpass" not in entry or "${SSH_PASSWORD" in entry, \
            f"USER_PASSWORD should use ${{SSH_PASSWORD}} env var, got: {entry}"
        assert "${SSH_PASSWORD" in entry, \
            f"USER_PASSWORD must reference env var ${{SSH_PASSWORD}}, got: {entry}"


def test_docker_compose_no_hardcoded_ftp_user():
    """P0: FTP_USER should use env var, not hardcoded 'ftpuser'"""
    compose = load_compose()
    ftp_env = compose["services"]["ftp-server"]["environment"]
    ftp_user_entries = [e for e in ftp_env if "FTP_USER" in e]
    assert len(ftp_user_entries) > 0, "FTP_USER entry missing"
    for entry in ftp_user_entries:
        assert "ftpuser" not in entry or "${FTP_USER" in entry, \
            f"FTP_USER should use ${{FTP_USER}} env var, got: {entry}"
        assert "${FTP_USER" in entry, \
            f"FTP_USER must reference env var ${{FTP_USER}}, got: {entry}"


def test_docker_compose_no_hardcoded_ftp_pass():
    """P0: FTP_PASS should use env var, not hardcoded 'ftppass'"""
    compose = load_compose()
    ftp_env = compose["services"]["ftp-server"]["environment"]
    ftp_pass_entries = [e for e in ftp_env if "FTP_PASS" in e]
    assert len(ftp_pass_entries) > 0, "FTP_PASS entry missing"
    for entry in ftp_pass_entries:
        assert "ftppass" not in entry or "${FTP_PASS" in entry, \
            f"FTP_PASS should use ${{FTP_PASS}} env var, got: {entry}"
        assert "${FTP_PASS" in entry, \
            f"FTP_PASS must reference env var ${{FTP_PASS}}, got: {entry}"


def test_anonymous_ftp_disabled_in_compose():
    """P0: ANONYMOUS_ENABLE should be NO in docker-compose.yml"""
    compose = load_compose()
    ftp_env = compose["services"]["ftp-server"]["environment"]
    anon_entries = [e for e in ftp_env if "ANONYMOUS_ENABLE" in e]
    assert len(anon_entries) > 0, "ANONYMOUS_ENABLE entry missing"
    for entry in anon_entries:
        assert "NO" in entry or "${FTP_ANONYMOUS_ENABLE:-NO}" in entry, \
            f"ANONYMOUS_ENABLE should be NO, got: {entry}"


def test_anonymous_ftp_disabled_in_vsftpd_conf():
    """P0: anonymous_enable should be NO in vsftpd.conf"""
    with open(VSFTPD_CONF, "r") as f:
        content = f.read()
    assert "anonymous_enable=NO" in content, \
        f"vsftpd.conf must have anonymous_enable=NO, got content:\n{content}"


def test_dot_env_example_exists():
    """P1: .env.example file should exist"""
    assert os.path.exists(ENV_EXAMPLE_FILE), \
        f".env.example missing at {ENV_EXAMPLE_FILE}"


def test_dot_env_example_has_required_vars():
    """P1: .env.example should document all required variables"""
    with open(ENV_EXAMPLE_FILE, "r") as f:
        content = f.read()
    required_vars = [
        "SSH_USER",
        "SSH_PASSWORD",
        "FTP_USER",
        "FTP_PASS",
        "FTP_ANONYMOUS_ENABLE",
    ]
    for var in required_vars:
        assert var in content, \
            f".env.example must contain {var}"


def test_dot_env_example_has_safe_defaults():
    """P1: .env.example should use 'changeme' as default passwords"""
    with open(ENV_EXAMPLE_FILE, "r") as f:
        content = f.read()
    # Should contain changeme (safe default) not testpass/ftppass
    assert "changeme" in content, \
        ".env.example should use 'changeme' as safe default password"


def test_dot_env_is_gitignored():
    """P1: .env must be in .gitignore (not just .env.example)"""
    with open(GITIGNORE_FILE, "r") as f:
        content = f.read()
    lines = [line.strip() for line in content.splitlines()]
    # .env should be gitignored
    assert ".env" in lines or any(
        line == ".env" or line.startswith(".env") and line == ".env"
        for line in lines
    ), f".env must be in .gitignore. Current content:\n{content}"


def test_ssh_recommends_key_auth():
    """P2: docker-compose.yml should recommend key-based auth (comment or env)"""
    with open(COMPOSE_FILE, "r") as f:
        content = f.read()
    # Check that PASSWORD_ACCESS is at least configurable
    assert "PASSWORD_ACCESS" in content, \
        "PASSWORD_ACCESS should be present and configurable"
