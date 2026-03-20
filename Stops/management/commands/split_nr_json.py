import os
import sys
import json
import gzip
import tempfile
from pathlib import Path
from typing import Optional, Dict, TextIO

from django.core.management.base import BaseCommand
from django.conf import settings
from dotenv import load_dotenv


class Command(BaseCommand):
    help = 'Download and split Network Rail CIF JSON file into separate NDJSON files by record type.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--url',
            type=str,
            default='https://publicdatafeeds.networkrail.co.uk/ntrod/CifFileAuthenticate?type=CIF_ALL_FULL_DAILY&day=toc-full',
            help='Network Rail download URL'
        )
        parser.add_argument(
            '--file',
            type=str,
            help='Local file path (gzipped or plain text) to split instead of downloading'
        )
        parser.add_argument(
            '--out-dir',
            type=str,
            default='data',
            help='Output directory for split files'
        )
        parser.add_argument(
            '--username',
            type=str,
            help='Network Rail username (overrides environment variables)'
        )
        parser.add_argument(
            '--password',
            type=str,
            help='Network Rail password (overrides environment variables)'
        )

    def handle(self, *args, **options):
        """Main command handler."""
        # Load credentials
        username, password = self._load_credentials(options)
        
        # Get output directory
        out_dir = Path(options.get('out_dir', 'data'))
        out_dir.mkdir(parents=True, exist_ok=True)
        
        # Download or use local file
        local_file = options.get('file')
        if local_file:
            data_path = self._use_local_file(local_file)
        else:
            if not username or not password:
                self.stderr.write(
                    self.style.ERROR(
                        'Error: NR_USERNAME and NR_PASSWORD are required.\n'
                        'Provide via --username/--password arguments or set in .env file'
                    )
                )
                sys.exit(1)
            
            url = options.get('url')
            data_path = self._download_file(url, username, password)
        
        if not data_path:
            sys.exit(1)
        
        # Split the file
        self._split_file(data_path, out_dir)
        
        # Clean up temp file if we downloaded it
        if not local_file and data_path.exists():
            try:
                data_path.unlink()
                self.stdout.write('Cleaned up temporary download file')
            except Exception:
                pass

    def _load_credentials(self, options: dict) -> tuple[Optional[str], Optional[str]]:
        """Load credentials from CLI args, .env file, or environment variables."""
        username = options.get('username')
        password = options.get('password')
        
        if not username or not password:
            # Try loading from .env file
            env_path = Path(settings.BASE_DIR) / '.env'
            if env_path.exists():
                load_dotenv(env_path)
                self.stdout.write(f'Loaded environment from {env_path}')
            
            username = username or os.environ.get('NR_USERNAME')
            password = password or os.environ.get('NR_PASSWORD')
        
        if username:
            self.stdout.write(f'Using Network Rail username: {username}')
        
        return username, password

    def _use_local_file(self, file_path: str) -> Optional[Path]:
        """Validate and return path to local file."""
        path = Path(file_path)
        if not path.exists():
            self.stderr.write(self.style.ERROR(f'Error: Local file not found: {file_path}'))
            return None
        
        self.stdout.write(f'Using local file: {path}')
        return path

    def _download_file(self, url: str, username: str, password: str) -> Optional[Path]:
        """Download file from Network Rail with proper authentication."""
        self.stdout.write(f'Downloading from: {url}')
        
        # Try importing requests library
        try:
            import requests
            return self._download_with_requests(url, username, password)
        except ImportError:
            self.stdout.write(
                self.style.WARNING(
                    'Warning: requests library not found, using urllib fallback.\n'
                    'For better reliability, install requests: pip install requests'
                )
            )
            return self._download_with_urllib(url, username, password)

    def _download_with_requests(self, url: str, username: str, password: str) -> Optional[Path]:
        """Download using requests library (preferred method)."""
        import requests
        
        self.stdout.write('Using requests library for download...')
        
        try:
            response = requests.get(
                url,
                auth=(username, password),
                headers={
                    'User-Agent': 'TransportStatistics/1.0',
                    'Accept': 'application/json, application/octet-stream, */*'
                },
                stream=True,
                timeout=120
            )
            
            if response.status_code != 200:
                self.stderr.write(
                    self.style.ERROR(
                        f'Error: Download failed with status {response.status_code}: {response.reason}'
                    )
                )
                # Show response body for debugging
                try:
                    body_preview = response.text[:1000]
                    self.stderr.write(f'Response preview: {body_preview}')
                except Exception:
                    pass
                return None
            
            # Create temporary file
            fd, tmp_path = tempfile.mkstemp(suffix='.gz', prefix='nr_cif_')
            os.close(fd)
            temp_file = Path(tmp_path)
            
            # Download with progress indication
            total_size = int(response.headers.get('content-length', 0))
            downloaded = 0
            chunk_size = 1024 * 1024  # 1MB chunks
            
            with open(temp_file, 'wb') as f:
                for chunk in response.iter_content(chunk_size=chunk_size):
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total_size > 0:
                            progress = (downloaded / total_size) * 100
                            self.stdout.write(f'\rProgress: {progress:.1f}%', ending='')
                        else:
                            self.stdout.write(f'\rDownloaded: {downloaded // 1024 // 1024} MB', ending='')
            
            self.stdout.write('')  # New line after progress
            file_size_mb = temp_file.stat().st_size / 1024 / 1024
            self.stdout.write(self.style.SUCCESS(f'Download complete: {file_size_mb:.1f} MB'))
            
            return temp_file
            
        except requests.exceptions.Timeout:
            self.stderr.write(self.style.ERROR('Error: Download timed out'))
            return None
        except requests.exceptions.RequestException as e:
            self.stderr.write(self.style.ERROR(f'Error: Download failed: {e}'))
            if hasattr(e, 'response') and e.response is not None:
                try:
                    self.stderr.write(f'Response status: {e.response.status_code}')
                    self.stderr.write(f'Response preview: {e.response.text[:1000]}')
                except Exception:
                    pass
            return None
        except Exception as e:
            self.stderr.write(self.style.ERROR(f'Error: Unexpected error during download: {e}'))
            return None

    def _download_with_urllib(self, url: str, username: str, password: str) -> Optional[Path]:
        """Download using urllib as fallback."""
        import base64
        from urllib.request import Request, urlopen
        from urllib.error import HTTPError, URLError
        
        self.stdout.write('Using urllib for download...')
        
        try:
            # Create request with authentication
            req = Request(url)
            req.add_header('User-Agent', 'TransportStatistics/1.0')
            req.add_header('Accept', 'application/json, application/octet-stream, */*')
            
            # Add basic authentication
            credentials = f"{username}:{password}".encode('utf-8')
            auth_token = base64.b64encode(credentials).decode('ascii')
            req.add_header('Authorization', f'Basic {auth_token}')
            
            # Open connection
            response = urlopen(req, timeout=120)
            
            # Create temporary file
            fd, tmp_path = tempfile.mkstemp(suffix='.gz', prefix='nr_cif_')
            os.close(fd)
            temp_file = Path(tmp_path)
            
            # Download with progress
            downloaded = 0
            chunk_size = 1024 * 1024  # 1MB chunks
            
            with open(temp_file, 'wb') as f:
                while True:
                    chunk = response.read(chunk_size)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    self.stdout.write(f'\rDownloaded: {downloaded // 1024 // 1024} MB', ending='')
            
            self.stdout.write('')  # New line
            file_size_mb = temp_file.stat().st_size / 1024 / 1024
            self.stdout.write(self.style.SUCCESS(f'Download complete: {file_size_mb:.1f} MB'))
            
            return temp_file
            
        except HTTPError as e:
            self.stderr.write(self.style.ERROR(f'Error: HTTP {e.code}: {e.reason}'))
            try:
                error_body = e.read().decode('utf-8')
                self.stderr.write(f'Response preview: {error_body[:1000]}')
            except Exception:
                pass
            return None
        except URLError as e:
            self.stderr.write(self.style.ERROR(f'Error: URL error: {e.reason}'))
            return None
        except Exception as e:
            self.stderr.write(self.style.ERROR(f'Error: Download failed: {e}'))
            return None

    def _split_file(self, input_path: Path, output_dir: Path):
        """Split the CIF JSON file into separate files by record type."""
        self.stdout.write(f'Processing file: {input_path}')
        
        # Open output files
        output_files = self._open_output_files(output_dir)
        
        try:
            # Open input file (handle both gzip and plain text)
            reader = self._open_input_file(input_path)
            
            if not reader:
                return
            
            # Process records
            counts = self._process_records(reader, output_files)
            
            # Close reader
            reader.close()
            
            # Report results
            self._report_results(counts)
            
        finally:
            # Close all output files
            for f in output_files.values():
                try:
                    f.close()
                except Exception:
                    pass

    def _open_output_files(self, output_dir: Path) -> Dict[str, TextIO]:
        """Open all output files for writing."""
        output_files = {
            'TiplocV1': open(output_dir / 'TiplocV1.ndjson', 'w', encoding='utf-8', newline=''),
            'JsonAssociationV1': open(output_dir / 'JsonAssociationV1.ndjson', 'w', encoding='utf-8', newline=''),
            'JsonScheduleV1': open(output_dir / 'JsonScheduleV1.ndjson', 'w', encoding='utf-8', newline=''),
            'JsonTimetableV1': open(output_dir / 'JsonTimetableV1.ndjson', 'w', encoding='utf-8', newline=''),
        }
        
        self.stdout.write(f'Created output files in: {output_dir}')
        return output_files

    def _open_input_file(self, path: Path) -> Optional[TextIO]:
        """Open input file, detecting if it's gzipped or plain text."""
        # Try opening as gzip first
        try:
            test_fh = gzip.open(path, 'rt', encoding='utf-8', errors='replace')
            # Try to read a line to verify it's valid gzip
            first_line = test_fh.readline()
            test_fh.close()
            
            if first_line:
                self.stdout.write('Detected gzip compressed file')
                return gzip.open(path, 'rt', encoding='utf-8', errors='replace')
        except (OSError, gzip.BadGzipFile):
            pass
        
        # Fall back to plain text
        try:
            self.stdout.write('Opening as plain text file')
            return open(path, 'r', encoding='utf-8', errors='replace')
        except Exception as e:
            self.stderr.write(self.style.ERROR(f'Error: Cannot open file: {e}'))
            return None

    def _process_records(self, reader: TextIO, output_files: Dict[str, TextIO]) -> Dict[str, int]:
        """Process all records from the input file."""
        counts = {
            'TiplocV1': 0,
            'JsonAssociationV1': 0,
            'JsonScheduleV1': 0,
            'JsonTimetableV1': 0,
            'unknown': 0,
            'malformed': 0,
        }
        
        line_number = 0
        
        for line in reader:
            line_number += 1
            line = line.strip()
            
            if not line:
                continue
            
            # Progress indicator
            if line_number % 100000 == 0:
                total = sum(counts.values())
                self.stdout.write(f'Processed {line_number:,} lines ({total:,} records)...')
            
            # Parse JSON
            try:
                record = json.loads(line)
            except json.JSONDecodeError as e:
                counts['malformed'] += 1
                if counts['malformed'] <= 10:  # Only show first 10 errors
                    self.stderr.write(f'Warning: Malformed JSON at line {line_number}: {e}')
                continue
            
            # Validate record structure
            if not isinstance(record, dict) or len(record) == 0:
                counts['unknown'] += 1
                continue
            
            # Extract record type and data
            record_type = next(iter(record.keys()))
            record_data = record[record_type]
            
            # Write to appropriate output file
            if record_type in output_files:
                output_files[record_type].write(json.dumps(record_data, ensure_ascii=False) + '\n')
                counts[record_type] += 1
            else:
                counts['unknown'] += 1
                if counts['unknown'] <= 10:  # Only show first 10 unknown types
                    self.stderr.write(f'Warning: Unknown record type at line {line_number}: {record_type}')
        
        return counts

    def _report_results(self, counts: Dict[str, int]):
        """Report processing results."""
        self.stdout.write(self.style.SUCCESS('\n=== Split Complete ==='))
        
        # Show counts for each record type
        total_written = 0
        for record_type in ['TiplocV1', 'JsonAssociationV1', 'JsonScheduleV1', 'JsonTimetableV1']:
            count = counts[record_type]
            total_written += count
            self.stdout.write(f'  {record_type}: {count:,} records')
        
        # Show issues if any
        if counts['unknown'] > 0:
            self.stdout.write(self.style.WARNING(f'  Unknown record types: {counts["unknown"]:,}'))
        
        if counts['malformed'] > 0:
            self.stdout.write(self.style.WARNING(f'  Malformed JSON lines: {counts["malformed"]:,}'))
        
        self.stdout.write(f'\nTotal records written: {total_written:,}')